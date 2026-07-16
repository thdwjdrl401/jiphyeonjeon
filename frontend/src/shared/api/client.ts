import axios, { AxiosHeaders, type AxiosError } from 'axios'

export interface FieldError {
  field: string
  code: string
}

interface ErrorResponse {
  code?: string
  message?: string
  fieldErrors?: FieldError[]
  correlationId?: string
}

interface CsrfResponse {
  token: string
  headerName: string
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly fieldErrors: FieldError[] = [],
    public readonly correlationId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const apiClient = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 15_000,
})

let csrf: CsrfResponse | null = null
let csrfRequest: Promise<CsrfResponse> | null = null

async function getCsrfToken() {
  if (csrf) return csrf
  if (!csrfRequest) {
    csrfRequest = apiClient
      .get<CsrfResponse>('/auth/csrf')
      .then(({ data }) => {
        csrf = data
        return data
      })
      .finally(() => {
        csrfRequest = null
      })
  }
  return csrfRequest
}

apiClient.interceptors.request.use(async (config) => {
  const method = config.method?.toUpperCase() ?? 'GET'
  const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)

  if (needsCsrf && config.url !== '/auth/csrf') {
    const token = await getCsrfToken()
    config.headers = AxiosHeaders.from(config.headers)
    config.headers.set(token.headerName, token.token)
  }

  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ErrorResponse>) => {
    const response = error.response
    const payload = response?.data

    if (response?.status === 401) csrf = null

    return Promise.reject(
      new ApiError(
        payload?.message ?? '요청을 처리하지 못했습니다.',
        response?.status,
        payload?.code,
        payload?.fieldErrors,
        payload?.correlationId,
      ),
    )
  },
)
