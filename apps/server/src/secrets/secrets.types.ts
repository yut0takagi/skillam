export interface Secret {
  id: number
  refName: string
  encryptedValue: string
  createdAt: string
  updatedAt: string
}

export interface CreateSecretInput {
  refName: string
  encryptedValue: string
}

export interface UpdateSecretInput {
  encryptedValue: string
}
