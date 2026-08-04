import type { FastifyPluginAsync } from 'fastify'
import { encrypt } from './secrets-cipher.js'
import type { MasterKeyProvider } from './master-key-provider.js'
import { SecretsRepository } from './secrets.repository.js'
import type { Secret } from './secrets.types.js'

export interface SecretsRouteDeps {
  secrets: SecretsRepository
  masterKeyProvider: MasterKeyProvider
}

function hasBody(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null
}

function toPublicSecret(secret: Secret) {
  return {
    id: secret.id,
    refName: secret.refName,
    createdAt: secret.createdAt,
    updatedAt: secret.updatedAt
  }
}

export const secretsRoutes: FastifyPluginAsync<SecretsRouteDeps> = async (app, deps) => {
  app.post<{ Body: { refName: string; value: string } }>('/secrets', async (request, reply) => {
    if (!hasBody(request.body)) {
      return reply.status(400).send({ error: 'request body is required' })
    }
    const { refName, value } = request.body
    if (typeof refName !== 'string' || refName.trim() === '') {
      return reply.status(400).send({ error: 'refName is required' })
    }
    if (typeof value !== 'string' || value === '') {
      return reply.status(400).send({ error: 'value is required' })
    }
    const key = deps.masterKeyProvider.getOrCreateKey()
    const encryptedValue = encrypt(value, key)
    const secret = deps.secrets.create({ refName, encryptedValue })
    return reply.status(201).send(toPublicSecret(secret))
  })

  app.get('/secrets', async () => {
    return deps.secrets.list().map(toPublicSecret)
  })

  app.get<{ Params: { id: string } }>('/secrets/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const secret = deps.secrets.getById(id)
    if (!secret) {
      return reply.status(404).send({ error: 'secret not found' })
    }
    return toPublicSecret(secret)
  })

  app.delete<{ Params: { id: string } }>('/secrets/:id', async (request, reply) => {
    const id = Number(request.params.id)
    const deleted = deps.secrets.delete(id)
    if (!deleted) {
      return reply.status(404).send({ error: 'secret not found' })
    }
    return reply.status(204).send()
  })
}
