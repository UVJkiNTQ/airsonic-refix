export interface Config {
  serverUrl: string
  /** Hardcoded username for auto-login (read-only kiosk mode).
   *  If set, the app will auto-login with this user without showing the login form.
   *  Requires apiKey or password to also be set. */
  username: string
  /** Hardcoded API key for auto-login (preferred for airsonic-pulse).
   *  Generate in server settings: Personal → API Keys */
  apiKey: string
  /** Hardcoded password for auto-login (legacy, not recommended).
   *  Use apiKey instead for airsonic-pulse compatibility. */
  password: string
}

const env = (window as any).env

export const config: Config = {
  serverUrl: env?.SERVER_URL || '',
  username: env?.USERNAME || '',
  apiKey: env?.API_KEY || '',
  password: env?.PASSWORD || '',
}
