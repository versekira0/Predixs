"use client";
import { useState } from "react";

export default function AgentCommandCenter() {
  const [input, setInput] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!input.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input }),
      });
      const data = await res.json();
      setResponse(data.content?.[0]?.text || "No response");
    } catch (e) {
      setResponse("Error: " + e.message);
    }
    setLoading(false);
  };

  return (
    <div style={{ padding: "2rem", maxWidth: "600px", margin: "0 auto" }}>
      <h1>AI Agent Command Center</h1>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={4}
        style={{ width: "100%", marginBottom: "1rem" }}
        placeholder="Type your message..."
      />
      <button onClick={handleSubmit} disabled={loading}>
        {loading ? "Loading..." : "Send"}
      </button>
      {response && <pre style={{ marginTop: "1rem" }}>{response}</pre>}
    </div>
  );
}
