export interface RoleMcpServer {
  id: number
  name: string
  command: unknown
  env: Record<string, string>
}

export interface RoleMcpServerInput {
  name: string
  command: unknown
  env?: Record<string, string>
}
