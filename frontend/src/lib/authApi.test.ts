import { describe, expect, it } from 'vitest'
import { authResponseSchema } from './authApi'

describe('authResponseSchema', () => {
  it('accepts the backend login contract', () => {
    const result = authResponseSchema.parse({
      accessToken: 'token',
      tokenType: 'bearer',
      expiresIn: 900,
      user: {
        id: '8bbdf436-0606-4431-a873-8d8a18e832be',
        email: 'user@example.com',
        role: 'user',
        status: 'active',
        forcePasswordChange: false,
      },
    })

    expect(result.user.email).toBe('user@example.com')
  })

  it('rejects an unknown user role', () => {
    const result = authResponseSchema.safeParse({
      accessToken: 'token',
      tokenType: 'bearer',
      expiresIn: 900,
      user: {
        id: '8bbdf436-0606-4431-a873-8d8a18e832be',
        email: 'user@example.com',
        role: 'admin',
        status: 'active',
        forcePasswordChange: false,
      },
    })

    expect(result.success).toBe(false)
  })
})
