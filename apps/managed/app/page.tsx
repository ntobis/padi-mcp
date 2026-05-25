export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>PADI MCP — managed service</h1>
      <p>
        MCP endpoint: <code>/api/mcp</code> (Streamable HTTP). Connect it as a custom connector
        from Claude.
      </p>
    </main>
  );
}
