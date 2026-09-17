export default {
  async fetch(): Promise<Response> {
    return new Response('bet or book - scaffold', { status: 200 });
  },
};
