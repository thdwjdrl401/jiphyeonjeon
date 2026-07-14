export interface LoginCredentials {
  id: string
  password: string
}

export interface LoginResponse {
  statusCode: number
  message: string
  accessToken: string
}

export interface AuthContextValue {
  accessToken: string | null
  isAuthenticated: boolean
  login: (credentials: LoginCredentials) => Promise<void>
  logout: () => void
}
