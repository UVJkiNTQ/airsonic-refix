import { md5, randomString, toQueryString } from '@/shared/utils'
import { config } from '@/shared/config'
import { inject } from 'vue'
import { App, Plugin } from '@/shared/compat'
import { pickBy } from 'lodash-es'

const API_VERSION = '1.16.1'

interface AuthParams {
  password?: string
  salt?: string
  hash?: string
  apiKey?: string
}

interface ServerInfo {
  name: string
  version: string
  openSubsonic: boolean
  extensions: string[]
}

function isApiKey(value: string): boolean {
  return value.startsWith('ap_')
}

export class AuthService {
  public server = ''
  public serverInfo = null as null | ServerInfo
  public username = ''
  private salt = ''
  private hash = ''
  private password = ''
  private apiKey = ''
  private authenticated = false

  constructor() {
    this.server = config.serverUrl || localStorage.getItem('server') || ''
    this.username = localStorage.getItem('username') || config.username || ''
    this.salt = localStorage.getItem('salt') || ''
    this.hash = localStorage.getItem('hash') || ''
    this.password = localStorage.getItem('password') || config.password || ''
    this.apiKey = localStorage.getItem('apiKey') || config.apiKey || ''
  }

  private saveSession() {
    if (!config.serverUrl) {
      localStorage.setItem('server', this.server)
    }
    localStorage.setItem('username', this.username)
    localStorage.setItem('salt', this.salt)
    localStorage.setItem('hash', this.hash)
    localStorage.setItem('password', this.password)
    localStorage.setItem('apiKey', this.apiKey)
  }

  /** Returns true if using API key authentication */
  get useApiKey(): boolean {
    return !!this.apiKey
  }

  async autoLogin(): Promise<boolean> {
    if (!this.server || !this.username) {
      return false
    }
    try {
      const auth = this.buildAuthParams()
      await login(this.server, this.username, auth)
      this.authenticated = true
      this.serverInfo = await fetchServerInfo(this.server, this.username, auth)
      return true
    } catch {
      return false
    }
  }

  async loginWithPassword(server: string, username: string, password: string): Promise<void> {
    // Detect API key (starts with "ap_")
    if (isApiKey(password)) {
      await login(server, username, { apiKey: password })
      this.salt = ''
      this.hash = ''
      this.password = ''
      this.apiKey = password
      this.server = server
      this.username = username
      this.authenticated = true
      this.serverInfo = await fetchServerInfo(server, username, { apiKey: password })
      this.saveSession()
      return
    }

    // Try API key auth first if we have a stored one, then legacy
    const salt = randomString()
    const hash = md5(password + salt)
    try {
      await login(server, username, { hash, salt })
      this.salt = salt
      this.hash = hash
      this.password = ''
      this.apiKey = ''
    } catch {
      try {
        await login(server, username, { password })
        this.salt = ''
        this.hash = ''
        this.password = password
        this.apiKey = ''
      } catch {
        // If both legacy methods fail, clear them and rethrow
        this.salt = ''
        this.hash = ''
        this.password = ''
        throw new Error(
          'Legacy password authentication is no longer supported by this server. ' +
          'Please generate an API key in your server settings (Personal → API Keys) ' +
          'and use it to log in.'
        )
      }
    }
    this.server = server
    this.username = username
    this.authenticated = true
    this.serverInfo = await fetchServerInfo(server, username, this.buildAuthParams())
    this.saveSession()
  }

  private buildAuthParams(): AuthParams {
    if (this.apiKey) {
      return { apiKey: this.apiKey }
    }
    return { salt: this.salt, hash: this.hash, password: this.password }
  }

  /** Query string params for GET requests.
   *  API key mode: only apiKey (u is NOT sent — key binds to user).
   *  Legacy mode: u + s/t/p as before. */
  get urlParams() {
    if (this.apiKey) {
      return toQueryString({ apiKey: this.apiKey })
    }
    return toQueryString(pickBy({
      u: this.username,
      s: this.salt,
      t: this.hash,
      p: this.password,
    }) as Record<string, string>)
  }

  /** Headers for API requests — apiKey is sent via query param to avoid CORS preflight */
  get authHeaders(): Record<string, string> {
    return {}
  }

  logout() {
    localStorage.clear()
    sessionStorage.clear()
  }

  isAuthenticated() {
    return this.authenticated
  }
}

function buildAuthQuery(auth: AuthParams): string {
  const params: Record<string, string> = {}
  if (auth.apiKey) {
    params.apiKey = auth.apiKey
  } else {
    if (auth.salt) params.s = auth.salt
    if (auth.hash) params.t = auth.hash
    if (auth.password) params.p = auth.password
  }
  return toQueryString(params)
}

function buildAuthHeaders(_auth: AuthParams): Record<string, string> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // apiKey is sent via query param (buildAuthQuery) to avoid CORS preflight
  return {}
}

async function login(server: string, username: string, auth: AuthParams) {
  const qs = buildAuthQuery(auth)
  const headers = buildAuthHeaders(auth)
  // API key mode: no u param (key binds to user); legacy: u required
  const userParam = auth.apiKey ? '' : `u=${encodeURIComponent(username)}&`
  const url = `${server}/rest/ping?${userParam}${qs}&v=${API_VERSION}&c=app&f=json`
  return fetch(url, { headers })
    .then(response => response.ok
      ? response.json()
      : Promise.reject(new Error(response.statusText)))
    .then((response) => {
      const subsonicResponse = response['subsonic-response']
      if (!subsonicResponse || subsonicResponse.status !== 'ok') {
        const message = subsonicResponse.error?.message || subsonicResponse.status
        throw new Error(message)
      }
    })
}

async function fetchServerInfo(server: string, username: string, auth: AuthParams): Promise<ServerInfo> {
  const qs = buildAuthQuery(auth)
  const headers = buildAuthHeaders(auth)
  const userParam = auth.apiKey ? '' : `u=${encodeURIComponent(username)}&`
  const url = `${server}/rest/getOpenSubsonicExtensions?${userParam}${qs}&v=${API_VERSION}&c=app&f=json`
  const response = await fetch(url, { headers })
  if (response.ok) {
    const body = await response.json()
    const subsonicResponse = body['subsonic-response']
    if (subsonicResponse?.status === 'ok') {
      // airsonic-pulse nests in { openSubsonicExtension: [...] }, older servers use flat array
      const extList = subsonicResponse.openSubsonicExtensions?.openSubsonicExtension ||
        subsonicResponse.openSubsonicExtensions ||
        []
      return {
        name: subsonicResponse.type,
        version: subsonicResponse.version,
        openSubsonic: true,
        extensions: extList.map((ext: any) => ext.name)
      }
    }
  }
  return { name: 'Subsonic', version: 'Unknown', openSubsonic: false, extensions: [] }
}

const apiSymbol = Symbol('')

export function useAuth(): AuthService {
  return inject(apiSymbol) as AuthService
}

export function createAuth(): AuthService & Plugin {
  const instance = new AuthService()
  return Object.assign(instance, {
    install: (app: App) => {
      app.provide(apiSymbol, instance)
    }
  })
}
