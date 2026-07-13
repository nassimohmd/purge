/// <reference lib="dom" />
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { isValidId } from '../_lib'

/**
 * Token-exchange route for direct browser -> Blob uploads of the (potentially
 * very large, tens-to-hundreds of MB for a real fleet) session snapshot. The
 * snapshot bytes never pass through this function's body — only the token
 * handshake does, so serverless request/response size limits don't apply.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadBody
  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const m = pathname.match(/^shares\/([^/]+)\/snapshot\.json$/)
        if (!m || !isValidId(m[1])) {
          throw new Error('Invalid share snapshot path')
        }
        return {
          access: 'public',
          allowedContentTypes: ['application/json'],
          addRandomSuffix: false,
          allowOverwrite: true,
        }
      },
      onUploadCompleted: async () => {
        // No server bookkeeping needed — the pathname itself is the identity;
        // GET /api/shares/:id looks the blob up by that same deterministic path.
      },
    })
    return Response.json(jsonResponse)
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 })
  }
}
