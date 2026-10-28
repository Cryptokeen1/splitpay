import { createAppServerKit, createSessionRouteHandler } from '@circle-fin/app-kit/server'
import { recoverMessageAddress, type Hex } from 'viem'
import { AUTH_MAX_AGE_SECONDS, appUserIdFor, parseAuthMessage } from '../src/lib/onrampAuth'

const apiKey = process.env.CIRCLE_API_KEY
if (!apiKey) throw new Error('CIRCLE_API_KEY is not set')

const server = createAppServerKit({
  onramp: {
    apiKey,
    // Sandbox by default. Omit both URLs for production, with a mainnet key.
    baseUrl: process.env.ONRAMP_API_BASE_URL,
    widgetBaseUrl: process.env.VITE_ONRAMP_WIDGET_BASE_URL,
    referrerDomain: process.env.ONRAMP_REFERRER_DOMAIN,
  },
})

/**
 * Only the owner of a wallet may open a session for it: the browser signs a short-lived message, and the
 * session's destination must be the signer's own address with the matching opaque user id.
 */
async function authorize(request: Request): Promise<boolean> {
  try {
    const message = decodeURIComponent(request.headers.get('x-auth-message') ?? '')
    const signature = request.headers.get('x-auth-signature') ?? ''
    const parsed = parseAuthMessage(message)
    if (!parsed || !/^0x[0-9a-fA-F]+$/.test(signature)) return false

    const age = Date.now() / 1000 - parsed.issued
    if (age < -60 || age > AUTH_MAX_AGE_SECONDS) return false

    const signer = await recoverMessageAddress({ message, signature: signature as Hex })
    if (signer.toLowerCase() !== parsed.address.toLowerCase()) return false

    const body: unknown = await request.clone().json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false
    const { destinationAddress, appUserId } = body as Record<string, unknown>
    if (typeof destinationAddress !== 'string' || destinationAddress.toLowerCase() !== signer.toLowerCase()) return false
    return appUserId === appUserIdFor(signer)
  } catch {
    return false
  }
}

const sessions = createSessionRouteHandler(server.onramp, {
  authorize,
  onError: (error, request) => {
    console.error('onramp session mint failed', { url: request.url, error })
  },
})

export default {
  port: 3001,
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/onramp/sessions') return sessions(request)
    if (pathname === '/api/health') return Response.json({ ok: true })
    return new Response('Not found', { status: 404 })
  },
}
