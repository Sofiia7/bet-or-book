import { extractAddress } from './guard';
import { checkAddress } from './api/check';
import pageHtml from '../web/index.html';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/check') {
      const raw = url.searchParams.get('address') ?? '';
      const address = extractAddress(raw);
      if (!address) {
        return Response.json(
          { error: 'no valid Hyperliquid address found in the address parameter' },
          { status: 400 },
        );
      }
      try {
        const result = await checkAddress(address);
        return Response.json(result);
      } catch (err) {
        console.error('check failed', err);
        return Response.json({ error: 'could not read this address right now, try again shortly' }, { status: 502 });
      }
    }

    if (url.pathname === '/') {
      return new Response(pageHtml, { headers: { 'content-type': 'text/html;charset=UTF-8' } });
    }

    return new Response('not found', { status: 404 });
  },
};
