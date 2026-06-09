"use client";
import { useState, useRef, useEffect } from "react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const C = {
  bg: "#07080c", surface: "#0d1117", elevated: "#161b22",
  border: "#21262d", borderHover: "#30363d",
  text: "#e6edf3", muted: "#8b949e", faint: "#484f58",
  purple: "#8b5cf6", purpleDim: "#4c1d95",
  green: "#3fb950", greenBg: "#0d2a0d",
  blue: "#58a6ff", blueBg: "#0d1a2e",
  red: "#f85149", redBg: "#2a0d0d",
  yellow: "#d29922", yellowBg: "#2a1f0d",
  cyan: "#39d0d8",
};

const PLATFORMS = {
  github:  { name: "GitHub",   icon: "🐙", color: "#e6edf3", desc: "Push kode, buat repo, commit" },
  vercel:  { name: "Vercel",   icon: "▲",  color: "#fff",    desc: "Deploy website, kelola project" },
  netlify: { name: "Netlify",  icon: "◆",  color: "#00c7b7", desc: "Deploy static site, CDN global" },
  alchemy: { name: "Alchemy",  icon: "⬡",  color: "#5b6ee1", desc: "Web3 API, blockchain data" },
  privy:   { name: "Privy",    icon: "🔐", color: "#9d7af5", desc: "Auth, wallet login, user mgmt" },
};

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
const buildSystemPrompt = (credentials, owner) => `
You are an AI coding agent working exclusively for the owner: ${owner || "the user"}.

CRITICAL RULES — YOU MUST FOLLOW THESE ALWAYS:
1. You ONLY act on explicit commands from the owner. Never assume, never do extra steps not asked.
2. Every action you take is on behalf of the owner. All repos, deployments, files are owned by them.
3. Before any destructive action (delete, overwrite), flag it in your notes — don't do it silently.
4. If a command is ambiguous, complete the safe interpretation and note what you assumed.
5. Never expose credentials in file contents or notes.

CONNECTED ACCOUNTS:
${credentials.github  ? "✅ GitHub connected"  : "❌ GitHub not connected"}
${credentials.vercel  ? "✅ Vercel connected"  : "❌ Vercel not connected"}
${credentials.netlify ? "✅ Netlify connected" : "❌ Netlify not connected"}
${credentials.alchemy ? "✅ Alchemy connected" : "❌ Alchemy not connected"}
${credentials.privy   ? "✅ Privy connected"   : "❌ Privy not connected"}

WHAT YOU CAN DO:
- Generate, fix, refactor, convert any code
- Create complete websites, apps, smart contracts
- Use github_actions: create_repo, push_file, list_repos
- Use vercel_actions: deploy_project, list_projects
- Use netlify_actions: deploy_site, list_sites
- Use alchemy_actions: get_balance, get_nfts, get_transactions
- Use privy_actions: scaffold_auth (generate Privy auth code)

Return ONLY raw JSON, no markdown, no backticks:
{
  "summary": "What you did in user's language",
  "plan": ["Step 1: ...", "Step 2: ..."],
  "files": [{ "filename": "x.html", "language": "html", "content": "...", "description": "..." }],
  "github_actions":  [{ "action": "create_repo|push_file|list_repos", ...params }],
  "vercel_actions":  [{ "action": "deploy_project", "project_name": "...", "files": [...] }],
  "netlify_actions": [{ "action": "deploy_site", "site_name": "...", "files": [...] }],
  "alchemy_actions": [{ "action": "get_balance", "address": "0x...", "network": "eth-mainnet" }],
  "privy_actions":   [{ "action": "scaffold_auth", "framework": "react|nextjs" }],
  "warnings": ["List any assumptions or things owner should review"],
  "notes": "Next steps or important info"
}

All actions arrays are optional — only include what the command requires.
github push_file params: { repo, path, content, message }
github create_repo params: { repo_name, description, private }
vercel deploy params: { project_name, files: [{name, content}] }
netlify deploy params: { site_name, files: [{name, content}] }
`.trim();

// ─── API HELPERS ──────────────────────────────────────────────────────────────
async function ghRequest(ep, token, method = "GET", body = null) {
  const r = await fetch(`https://api.github.com${ep}`, {
    method,
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || `GitHub ${r.status}`);
  return d;
}

async function vercelRequest(ep, token, method = "GET", body = null) {
  const r = await fetch(`https://api.vercel.com${ep}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || `Vercel ${r.status}`);
  return d;
}

async function netlifyRequest(ep, token, method = "GET", body = null) {
  const r = await fetch(`https://api.netlify.com/api/v1${ep}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || `Netlify ${r.status}`);
  return d;
}

async function alchemyRequest(apiKey, network, method, params) {
  const url = `https://${network}.g.alchemy.com/v2/${apiKey}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d.result;
}

// Push single file to GitHub
async function ghPushFile(token, repo, path, content, message) {
  const enc = btoa(unescape(encodeURIComponent(content)));
  let sha;
  try { const ex = await ghRequest(`/repos/${repo}/contents/${path}`, token); sha = ex.sha; } catch {}
  return ghRequest(`/repos/${repo}/contents/${path}`, token, "PUT", { message, content: enc, ...(sha ? { sha } : {}) });
}

// Deploy to Vercel via Files API
async function vercelDeploy(token, projectName, files) {
  const filePayload = files.map(f => ({ file: f.name, data: f.content, encoding: "utf-8" }));
  return vercelRequest("/v13/deployments", token, "POST", {
    name: projectName, files: filePayload, projectSettings: { framework: null },
  });
}

// Deploy to Netlify (create site then deploy)
async function netlifyDeploy(token, siteName, files) {
  // Create or get site
  let site;
  try {
    const sites = await netlifyRequest("/sites", token);
    site = sites.find(s => s.name === siteName);
  } catch {}
  if (!site) site = await netlifyRequest("/sites", token, "POST", { name: siteName });
  // Deploy files
  const fileDigests = {};
  files.forEach(f => { fileDigests[`/${f.name}`] = btoa(unescape(encodeURIComponent(f.content))).length.toString(16); });
  return netlifyRequest(`/sites/${site.id}/deploys`, token, "POST", { files: fileDigests });
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function AgentCommandCenter() {
  // Credentials vault
  const [groqKey, setGroqKey] = useState("");
  const [creds, setCreds] = useState(() => {
    try { return JSON.parse(localStorage.getItem("acc_vault") || "{}"); } catch { return {}; }
  });
  const [vaultOpen, setVaultOpen] = useState(false);
  const [vaultInputs, setVaultInputs] = useState({});
  const [showTokens, setShowTokens] = useState({});
  const [verifyingCred, setVerifyingCred] = useState(null);
  const [ghUser, setGhUser] = useState(null);

  // Agent state
  const [code, setCode] = useState("");
  const [command, setCommand] = useState("");
  const [targetRepo, setTargetRepo] = useState("");
  const [repos, setRepos] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [activeFile, setActiveFile] = useState(0);
  const [logs, setLogs] = useState([]);
  const [previewMode, setPreviewMode] = useState(false);
  const [copied, setCopied] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null); // { label, onConfirm }
  const [activeTab, setActiveTab] = useState("agent"); // agent | vault

  const logRef = useRef(null);
  useEffect(() => { logRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  const saveCreds = (newCreds) => {
    setCreds(newCreds);
    localStorage.setItem("acc_vault", JSON.stringify(newCreds));
  };

  const addLog = (msg, type = "info", platform = null) =>
    setLogs(p => [...p, { msg, type, platform, time: new Date().toLocaleTimeString() }]);

  const connectedCount = Object.keys(creds).filter(k => creds[k]).length;

  // ── Verify & Save Credential ───────────────────────────────────────────────
  const verifyCred = async (platform) => {
    const val = vaultInputs[platform]?.trim();
    if (!val) return;
    setVerifyingCred(platform);
    try {
      if (platform === "github") {
        const user = await ghRequest("/user", val);
        setGhUser(user);
        const repoList = await ghRequest("/user/repos?per_page=50&sort=updated", val);
        setRepos(repoList);
        saveCreds({ ...creds, github: val });
        addLog(`✅ GitHub: terhubung sebagai @${user.login}`, "success", "github");
      } else if (platform === "vercel") {
        const u = await vercelRequest("/v2/user", val);
        saveCreds({ ...creds, vercel: val });
        addLog(`✅ Vercel: terhubung sebagai ${u.user?.username || u.user?.email}`, "success", "vercel");
      } else if (platform === "netlify") {
        const u = await netlifyRequest("/user", val);
        saveCreds({ ...creds, netlify: val });
        addLog(`✅ Netlify: terhubung sebagai ${u.full_name || u.email}`, "success", "netlify");
      } else if (platform === "alchemy") {
        // Test with mainnet blockNumber
        await alchemyRequest(val, "eth-mainnet", "eth_blockNumber", []);
        saveCreds({ ...creds, alchemy: val });
        addLog(`✅ Alchemy: API key valid`, "success", "alchemy");
      } else if (platform === "privy") {
        // Privy App ID — just save it, no simple verify endpoint
        saveCreds({ ...creds, privy: val });
        addLog(`✅ Privy: App ID tersimpan`, "success", "privy");
      }
      setVaultInputs(p => ({ ...p, [platform]: "" }));
    } catch (e) {
      addLog(`❌ ${PLATFORMS[platform].name}: ${e.message}`, "error", platform);
      alert(`❌ Gagal verify ${PLATFORMS[platform].name}: ${e.message}`);
    } finally {
      setVerifyingCred(null);
    }
  };

  const disconnectPlatform = (platform) => {
    const next = { ...creds };
    delete next[platform];
    saveCreds(next);
    if (platform === "github") { setGhUser(null); setRepos([]); }
    addLog(`🔌 ${PLATFORMS[platform].name} diputus`, "warn", platform);
  };

  // ── Run Agent ──────────────────────────────────────────────────────────────
  const runAgent = async () => {
    if (!command.trim()) return;
    if (!groqKey.trim()) { alert("Masukkan Groq API Key dulu!"); return; }
    setProcessing(true);
    setResult(null);
    setError(null);
    setLogs([]);
    setActiveFile(0);
    setPreviewMode(false);

    addLog("🤖 Agent aktif, memproses perintah...", "start");
    addLog(`🎯 "${command}"`, "cmd");
    if (code.trim()) addLog(`📦 Kode diterima — ${code.length} karakter`, "info");
    if (connectedCount > 0) addLog(`🔐 ${connectedCount} akun terhubung`, "success");
    addLog("⚙️ Menghubungi Claude AI...", "info");

    const owner = ghUser?.login || "owner";
    let userMsg = "";
    if (ghUser) userMsg += `Owner: @${ghUser.login} (${ghUser.name || ""})\n`;
    if (repos.length) userMsg += `Available repos: ${repos.slice(0, 15).map(r => r.full_name).join(", ")}\n`;
    if (targetRepo) userMsg += `Target repo: ${targetRepo}\n`;
    userMsg += `\n`;
    if (code.trim()) userMsg += `Code:\n\`\`\`\n${code}\n\`\`\`\n\n`;
    userMsg += `Command: ${command}`;

    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: buildSystemPrompt(creds, owner) },
            { role: "user", content: userMsg }
          ],
        }),
      });

      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content || "";
      let parsed;
      try { parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()); }
      catch { throw new Error("Gagal parse respons agent."); }

      addLog("✅ AI selesai bekerja", "success");
      if (parsed.plan?.length) parsed.plan.forEach(s => addLog(`   ${s}`, "plan"));
      if (parsed.files?.length) addLog(`📁 ${parsed.files.length} file dihasilkan`, "success");

      // ── Execute GitHub Actions ────────────────────────────────────────────
      if (parsed.github_actions?.length) {
        if (!creds.github) { addLog("⚠️ GitHub action diminta tapi token tidak ada", "warn"); }
        else {
          for (const a of parsed.github_actions) {
            try {
              if (a.action === "create_repo") {
                addLog(`🐙 GitHub: membuat repo "${a.repo_name}"...`, "info", "github");
                const repo = await ghRequest("/user/repos", creds.github, "POST", { name: a.repo_name, description: a.description || "", private: a.private || false, auto_init: true });
                addLog(`✅ Repo dibuat: ${repo.html_url}`, "success", "github");
                setRepos(p => [repo, ...p]);
              } else if (a.action === "push_file") {
                const repo = a.repo || targetRepo;
                if (!repo) { addLog("⚠️ Repo tidak ditentukan untuk push_file", "warn", "github"); continue; }
                addLog(`🐙 GitHub: push "${a.path}" → ${repo}`, "info", "github");
                await ghPushFile(creds.github, repo, a.path, a.content, a.message || `Add ${a.path} via AI Agent`);
                addLog(`✅ "${a.path}" berhasil di-push!`, "success", "github");
              } else if (a.action === "list_repos") {
                const list = await ghRequest("/user/repos?per_page=50&sort=updated", creds.github);
                setRepos(list);
                addLog(`✅ GitHub: ${list.length} repo ditemukan`, "success", "github");
              }
            } catch (e) { addLog(`❌ GitHub ${a.action}: ${e.message}`, "error", "github"); }
          }
        }
      }

      // ── Execute Vercel Actions ────────────────────────────────────────────
      if (parsed.vercel_actions?.length) {
        if (!creds.vercel) { addLog("⚠️ Vercel action diminta tapi token tidak ada", "warn"); }
        else {
          for (const a of parsed.vercel_actions) {
            try {
              if (a.action === "deploy_project") {
                addLog(`▲ Vercel: deploy "${a.project_name}"...`, "info", "vercel");
                const files = a.files || parsed.files?.map(f => ({ name: f.filename, content: f.content })) || [];
                const dep = await vercelDeploy(creds.vercel, a.project_name, files);
                addLog(`✅ Vercel: deployed! ${dep.url ? "https://" + dep.url : ""}`, "success", "vercel");
              } else if (a.action === "list_projects") {
                const projs = await vercelRequest("/v9/projects", creds.vercel);
                addLog(`✅ Vercel: ${projs.projects?.length || 0} project ditemukan`, "success", "vercel");
              }
            } catch (e) { addLog(`❌ Vercel ${a.action}: ${e.message}`, "error", "vercel"); }
          }
        }
      }

      // ── Execute Netlify Actions ───────────────────────────────────────────
      if (parsed.netlify_actions?.length) {
        if (!creds.netlify) { addLog("⚠️ Netlify action diminta tapi token tidak ada", "warn"); }
        else {
          for (const a of parsed.netlify_actions) {
            try {
              if (a.action === "deploy_site") {
                addLog(`◆ Netlify: deploy "${a.site_name}"...`, "info", "netlify");
                const files = a.files || parsed.files?.map(f => ({ name: f.filename, content: f.content })) || [];
                const dep = await netlifyDeploy(creds.netlify, a.site_name, files);
                addLog(`✅ Netlify: deployed! ${dep.deploy_url || dep.url || ""}`, "success", "netlify");
              }
            } catch (e) { addLog(`❌ Netlify ${a.action}: ${e.message}`, "error", "netlify"); }
          }
        }
      }

      // ── Execute Alchemy Actions ───────────────────────────────────────────
      if (parsed.alchemy_actions?.length) {
        if (!creds.alchemy) { addLog("⚠️ Alchemy action diminta tapi API key tidak ada", "warn"); }
        else {
          for (const a of parsed.alchemy_actions) {
            try {
              if (a.action === "get_balance") {
                addLog(`⬡ Alchemy: cek balance ${a.address?.slice(0, 10)}...`, "info", "alchemy");
                const bal = await alchemyRequest(creds.alchemy, a.network || "eth-mainnet", "eth_getBalance", [a.address, "latest"]);
                const eth = (parseInt(bal, 16) / 1e18).toFixed(4);
                addLog(`✅ Balance: ${eth} ETH`, "success", "alchemy");
              } else if (a.action === "get_nfts") {
                addLog(`⬡ Alchemy: ambil NFT ${a.address?.slice(0, 10)}...`, "info", "alchemy");
                const nfts = await alchemyRequest(creds.alchemy, a.network || "eth-mainnet", "alchemy_getNFTs", [{ owner: a.address }]);
                addLog(`✅ ${nfts?.totalCount || 0} NFT ditemukan`, "success", "alchemy");
              }
            } catch (e) { addLog(`❌ Alchemy ${a.action}: ${e.message}`, "error", "alchemy"); }
          }
        }
      }

      // ── Privy scaffold (code gen, no real API call needed) ────────────────
      if (parsed.privy_actions?.length) {
        parsed.privy_actions.forEach(a => {
          addLog(`🔐 Privy: scaffold ${a.framework} auth code disiapkan`, "success", "privy");
        });
      }

      // ── Warnings ─────────────────────────────────────────────────────────
      parsed.warnings?.forEach(w => addLog(`⚠️ ${w}`, "warn"));
      addLog("🎉 Semua selesai!", "done");
      setResult(parsed);
    } catch (e) {
      addLog(`❌ ${e.message}`, "error");
      setError(e.message);
    } finally {
      setProcessing(false);
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  const downloadFile = (f) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([f.content], { type: "text/plain" }));
    a.download = f.filename; a.click();
  };
  const getIcon = (fn) => ({ ".html": "🌐", ".css": "🎨", ".js": "⚡", ".jsx": "⚡", ".ts": "💙", ".tsx": "💙", ".py": "🐍", ".json": "📋", ".md": "📝", ".sol": "⬡" }[fn.match(/\.[^.]+$/)?.[0]] || "📄");
  const getLangColor = (l) => ({ html: "#e34c26", css: "#264de4", javascript: "#f7df1e", typescript: "#3178c6", python: "#3776ab", solidity: "#627eea", jsx: "#61dafb" }[l?.toLowerCase()] || "#888");
  const logColor = (t) => ({ error: C.red, success: C.green, done: C.green, warn: C.yellow, start: C.purple, cmd: C.cyan, plan: C.blue, info: C.muted }[t] || C.muted);

  const canPreview = result?.files?.some(f => f.filename.endsWith(".html"));
  const previewHtml = result?.files?.find(f => f.filename.endsWith(".html"))?.content || "";

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Inter', system-ui, sans-serif", color: C.text }}>

      {/* HEADER */}
      <div style={{ borderBottom: `1px solid ${C.border}`, background: "rgba(7,8,12,0.97)", backdropFilter: "blur(16px)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1160, margin: "0 auto", padding: "0 20px", display: "flex", alignItems: "center", height: 56, gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #8b5cf6, #6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🤖</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.3px" }}>AI Agent Command Center</div>
            <div style={{ fontSize: 10, color: C.muted }}>Owner-controlled · Semua atas nama akun kamu</div>
          </div>

          {/* Nav tabs */}
          <div style={{ marginLeft: 28, display: "flex", gap: 2 }}>
            {["agent", "vault"].map(t => (
              <button key={t} onClick={() => setActiveTab(t)} style={{
                padding: "5px 14px", borderRadius: 7, border: "none",
                background: activeTab === t ? C.elevated : "transparent",
                color: activeTab === t ? C.text : C.muted,
                cursor: "pointer", fontSize: 12, fontWeight: 600, textTransform: "capitalize",
              }}>
                {t === "agent" ? "🤖 Agent" : `🔑 Vault ${connectedCount > 0 ? `(${connectedCount})` : ""}`}
              </button>
            ))}
          </div>

          {/* Groq API Key */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
            <input
              type="password"
              value={groqKey}
              onChange={e => setGroqKey(e.target.value)}
              placeholder="Groq API Key..."
              style={{ padding: "5px 10px", background: "#161b22", border: `1px solid ${groqKey ? "#3fb950" : "#21262d"}`, borderRadius: 7, color: "#e6edf3", fontSize: 11, fontFamily: "monospace", outline: "none", width: 180 }}
            />
            {groqKey && <span style={{ fontSize: 10, color: "#3fb950" }}>✅</span>}
          </div>
          {/* Connected pills */}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {Object.entries(PLATFORMS).map(([key, p]) => (
              <div key={key} title={p.name} style={{
                width: 28, height: 28, borderRadius: 7, fontSize: 13,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: creds[key] ? p.color + "18" : C.elevated,
                border: `1px solid ${creds[key] ? p.color + "55" : C.border}`,
                opacity: creds[key] ? 1 : 0.35, cursor: "pointer",
              }} onClick={() => setActiveTab("vault")}>
                {p.icon}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "20px 20px 60px" }}>

        {/* ── VAULT TAB ──────────────────────────────────────────────────── */}
        {activeTab === "vault" && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>🔑 Token Vault</div>
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>Hubungkan akun-akunmu. Token disimpan <strong style={{ color: C.green }}>permanen di device ini</strong> — input sekali, agent ingat selamanya.</div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.greenBg, border: `1px solid ${C.green}33`, borderRadius: 8, padding: "5px 12px", fontSize: 11, color: C.green }}>
                💾 Tersimpan permanen di browser · Tidak perlu input ulang meski browser ditutup
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
              {Object.entries(PLATFORMS).map(([key, p]) => {
                const connected = !!creds[key];
                return (
                  <div key={key} style={{ background: C.surface, border: `1px solid ${connected ? p.color + "44" : C.border}`, borderRadius: 14, overflow: "hidden" }}>
                    {/* Platform header */}
                    <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 9, background: p.color + "18", border: `1px solid ${p.color}33`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: p.color }}>
                        {p.icon}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: C.muted }}>{p.desc}</div>
                      </div>
                      {connected && (
                        <div style={{ marginLeft: "auto", background: C.greenBg, border: `1px solid ${C.green}44`, borderRadius: 20, padding: "2px 10px", fontSize: 10, color: C.green, fontWeight: 700 }}>● CONNECTED</div>
                      )}
                    </div>

                    <div style={{ padding: 14 }}>
                      {connected ? (
                        <div style={{ display: "flex", gap: 8 }}>
                          <div style={{ flex: 1, padding: "8px 12px", background: C.elevated, borderRadius: 8, fontSize: 12, color: C.muted, fontFamily: "monospace" }}>
                            {creds[key].slice(0, 8)}••••••••{creds[key].slice(-4)}
                          </div>
                          <button onClick={() => disconnectPlatform(key)} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.red, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                            Disconnect
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 8 }}>
                          <div style={{ position: "relative", flex: 1 }}>
                            <input
                              type={showTokens[key] ? "text" : "password"}
                              value={vaultInputs[key] || ""}
                              onChange={e => setVaultInputs(p2 => ({ ...p2, [key]: e.target.value }))}
                              onKeyDown={e => e.key === "Enter" && verifyCred(key)}
                              placeholder={key === "github" ? "ghp_xxx..." : key === "vercel" ? "Vercel token..." : key === "netlify" ? "Netlify token..." : key === "alchemy" ? "Alchemy API key..." : "Privy App ID..."}
                              style={{ width: "100%", padding: "8px 36px 8px 12px", background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 12, fontFamily: "monospace", outline: "none", boxSizing: "border-box" }}
                            />
                            <button onClick={() => setShowTokens(p2 => ({ ...p2, [key]: !p2[key] }))} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>
                              {showTokens[key] ? "🙈" : "👁️"}
                            </button>
                          </div>
                          <button onClick={() => verifyCred(key)} disabled={verifyingCred === key || !vaultInputs[key]?.trim()} style={{
                            padding: "8px 14px", borderRadius: 8, border: "none",
                            background: `linear-gradient(135deg, ${p.color}cc, ${p.color}88)`,
                            color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700,
                            opacity: !vaultInputs[key]?.trim() ? 0.5 : 1,
                          }}>
                            {verifyingCred === key ? "⏳" : "Connect"}
                          </button>
                        </div>
                      )}

                      {/* How to get token hint */}
                      {!connected && (
                        <div style={{ marginTop: 10, fontSize: 11, color: C.faint, lineHeight: 1.6 }}>
                          {key === "github" && "github.com → Settings → Developer settings → Personal access tokens → Generate new (classic) → centang repo, workflow"}
                          {key === "vercel" && "vercel.com → Settings → Tokens → Create token"}
                          {key === "netlify" && "app.netlify.com → User settings → Applications → New access token"}
                          {key === "alchemy" && "dashboard.alchemy.com → Apps → Create app → View key → Copy API Key"}
                          {key === "privy" && "console.privy.io → Create app → Copy App ID dari Settings"}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Activity from vault */}
            {logs.length > 0 && (
              <div style={{ marginTop: 16, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 16px", maxHeight: 160, overflowY: "auto" }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginBottom: 8, letterSpacing: 1 }}>VAULT LOG</div>
                {logs.map((l, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, fontSize: 11, fontFamily: "monospace", marginBottom: 3, color: logColor(l.type) }}>
                    <span style={{ color: C.faint, flexShrink: 0 }}>{l.time}</span>
                    <span>{l.msg}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── AGENT TAB ──────────────────────────────────────────────────── */}
        {activeTab === "agent" && (
          <div>
            {/* Input grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              {/* Code */}
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "8px 14px", borderBottom: `1px solid ${C.border}`, background: C.elevated, display: "flex", alignItems: "center", gap: 8 }}>
                  <span>💻</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: 0.5 }}>KODE KAMU</span>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: C.faint }}>Optional</span>
                </div>
                <textarea
                  value={code} onChange={e => setCode(e.target.value)}
                  placeholder={"// Paste kode di sini...\n// HTML, CSS, JS, Python, Solidity, dll\n// Atau kosong untuk buat dari nol"}
                  style={{ width: "100%", height: 190, padding: 14, background: "transparent", border: "none", outline: "none", color: C.text, fontSize: 12, fontFamily: "'Fira Code', monospace", lineHeight: 1.65, resize: "none", boxSizing: "border-box" }}
                />
              </div>

              {/* Command + Options */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", flex: 1 }}>
                  <div style={{ padding: "8px 14px", borderBottom: `1px solid ${C.border}`, background: C.elevated, display: "flex", alignItems: "center", gap: 8 }}>
                    <span>🎯</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: 0.5 }}>PERINTAHMU</span>
                    <span style={{ marginLeft: "auto", fontSize: 10, color: C.faint }}>Semua dalam bahasa kamu</span>
                  </div>
                  <textarea
                    value={command} onChange={e => setCommand(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && e.ctrlKey && runAgent()}
                    placeholder={"Ketik perintah bebas, contoh:\n• \"Buatkan website portfolio dan push ke repo my-portfolio\"\n• \"Deploy landing page ini ke Vercel dengan nama my-app\"\n• \"Cek balance wallet 0x... di Ethereum\"\n• \"Buatkan smart contract ERC-20 dan scaffold Privy auth\""}
                    style={{ width: "100%", height: 100, padding: 14, background: "transparent", border: "none", outline: "none", color: C.text, fontSize: 12, fontFamily: "inherit", lineHeight: 1.65, resize: "none", boxSizing: "border-box" }}
                  />
                </div>

                {/* Repo selector */}
                {creds.github && repos.length > 0 && (
                  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ padding: "6px 14px", borderBottom: `1px solid ${C.border}`, background: C.elevated, fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: 0.5 }}>🐙 TARGET REPO</div>
                    <select value={targetRepo} onChange={e => setTargetRepo(e.target.value)} style={{ width: "100%", padding: "8px 14px", background: "transparent", border: "none", outline: "none", color: targetRepo ? C.text : C.faint, fontSize: 12, cursor: "pointer" }}>
                      <option value="">— Optional: pilih repo atau biar agent buat baru —</option>
                      {repos.map(r => <option key={r.id} value={r.full_name}>{r.full_name} {r.private ? "🔒" : "🌐"}</option>)}
                    </select>
                  </div>
                )}

                {/* Warning: no accounts connected */}
                {connectedCount === 0 && (
                  <div onClick={() => setActiveTab("vault")} style={{
                    padding: "8px 14px", borderRadius: 9,
                    background: C.yellowBg, border: `1px solid ${C.yellow}44`,
                    color: C.yellow, fontSize: 11, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 8,
                  }}>
                    ⚠️ Belum ada akun terhubung — klik untuk ke Vault →
                  </div>
                )}

                {/* Run button */}
                <button onClick={runAgent} disabled={processing || !command.trim()} style={{
                  padding: "13px", borderRadius: 10, border: "none",
                  background: processing ? C.elevated : "linear-gradient(135deg, #8b5cf6, #6366f1)",
                  color: "#fff", fontWeight: 700, fontSize: 14, cursor: processing ? "not-allowed" : "pointer",
                  opacity: !command.trim() ? 0.4 : 1,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  boxShadow: processing ? "none" : "0 0 28px rgba(139,92,246,0.4)",
                  transition: "all 0.2s",
                }}>
                  {processing
                    ? <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⚙️</span> Agent bekerja...</>
                    : <> 🚀 Jalankan Agent <span style={{ fontSize: 10, opacity: 0.6 }}>Ctrl+Enter</span></>}
                </button>
              </div>
            </div>

            {/* Activity Log */}
            {logs.length > 0 && (
              <div style={{ background: "#07080c", border: `1px solid #1a1a2e`, borderRadius: 10, padding: "10px 14px", marginBottom: 14, maxHeight: 160, overflowY: "auto" }}>
                <div style={{ fontSize: 10, color: C.purple, fontWeight: 700, marginBottom: 6, letterSpacing: 1 }}>▶ ACTIVITY LOG</div>
                {logs.map((l, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, fontSize: 11, fontFamily: "monospace", marginBottom: 2, color: logColor(l.type) }}>
                    <span style={{ color: C.faint, flexShrink: 0 }}>{l.time}</span>
                    {l.platform && <span style={{ color: PLATFORMS[l.platform]?.color + "bb", flexShrink: 0 }}>[{PLATFORMS[l.platform]?.icon}{l.platform}]</span>}
                    <span>{l.msg}</span>
                  </div>
                ))}
                <div ref={logRef} />
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{ background: C.redBg, border: `1px solid ${C.red}44`, borderRadius: 10, padding: 14, marginBottom: 14, color: C.red, fontSize: 13 }}>
                ❌ {error}
              </div>
            )}

            {/* Result */}
            {result && (
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                {/* Result header */}
                <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, background: C.elevated, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 20 }}>✅</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{result.summary}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                      {result.files?.length || 0} file
                      {result.github_actions?.length ? ` · ${result.github_actions.length} GitHub action` : ""}
                      {result.vercel_actions?.length ? ` · Vercel deploy` : ""}
                      {result.netlify_actions?.length ? ` · Netlify deploy` : ""}
                      {result.alchemy_actions?.length ? ` · Alchemy query` : ""}
                    </div>
                  </div>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    {canPreview && (
                      <button onClick={() => setPreviewMode(!previewMode)} style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid ${C.border}`, background: previewMode ? "#1f6feb" : "transparent", color: previewMode ? "#fff" : C.muted, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                        👁️ Preview
                      </button>
                    )}
                    <button onClick={() => result.files?.forEach(f => downloadFile(f))} style={{ padding: "5px 12px", borderRadius: 7, background: "linear-gradient(135deg, #238636, #2ea043)", border: "none", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                      ⬇️ Download Semua
                    </button>
                  </div>
                </div>

                {/* Warnings */}
                {result.warnings?.length > 0 && (
                  <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, background: C.yellowBg, display: "flex", gap: 8 }}>
                    <span>⚠️</span>
                    <div style={{ fontSize: 12, color: C.yellow, lineHeight: 1.6 }}>
                      {result.warnings.map((w, i) => <div key={i}>{w}</div>)}
                    </div>
                  </div>
                )}

                {/* Preview */}
                {previewMode && canPreview && (
                  <div style={{ borderBottom: `1px solid ${C.border}` }}>
                    <iframe srcDoc={previewHtml} style={{ width: "100%", height: 360, border: "none", background: "#fff" }} sandbox="allow-scripts allow-same-origin" title="Preview" />
                  </div>
                )}

                {/* File tabs */}
                {result.files?.length > 0 && (
                  <>
                    <div style={{ display: "flex", background: C.elevated, borderBottom: `1px solid ${C.border}`, overflowX: "auto" }}>
                      {result.files.map((f, i) => (
                        <button key={i} onClick={() => setActiveFile(i)} style={{
                          padding: "8px 14px", border: "none",
                          borderBottom: activeFile === i ? `2px solid ${C.purple}` : "2px solid transparent",
                          background: "transparent", color: activeFile === i ? C.text : C.muted,
                          cursor: "pointer", fontSize: 11.5, fontWeight: 600,
                          display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
                        }}>
                          {getIcon(f.filename)} {f.filename}
                        </button>
                      ))}
                    </div>

                    {result.files[activeFile] && (() => {
                      const f = result.files[activeFile];
                      return (
                        <div>
                          <div style={{ padding: "7px 14px", background: C.bg, display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${C.border}` }}>
                            <span style={{ padding: "2px 7px", borderRadius: 4, fontSize: 9, fontWeight: 700, background: getLangColor(f.language) + "22", color: getLangColor(f.language), border: `1px solid ${getLangColor(f.language)}44` }}>{f.language?.toUpperCase() || "TEXT"}</span>
                            <span style={{ fontSize: 11, color: C.muted }}>{f.description}</span>
                            <div style={{ marginLeft: "auto", display: "flex", gap: 7 }}>
                              <button onClick={() => { navigator.clipboard.writeText(f.content); setCopied(activeFile); setTimeout(() => setCopied(null), 2000); }} style={{ padding: "3px 10px", borderRadius: 5, border: `1px solid ${C.border}`, background: "transparent", color: copied === activeFile ? C.green : C.muted, cursor: "pointer", fontSize: 11 }}>
                                {copied === activeFile ? "✅ Copied!" : "📋 Copy"}
                              </button>
                              <button onClick={() => downloadFile(f)} style={{ padding: "3px 10px", borderRadius: 5, border: `1px solid ${C.border}`, background: "transparent", color: C.blue, cursor: "pointer", fontSize: 11 }}>⬇️ Download</button>
                            </div>
                          </div>
                          <div style={{ maxHeight: 360, overflowY: "auto", background: C.bg }}>
                            <pre style={{ margin: 0, padding: 16, fontSize: 12, lineHeight: 1.7, fontFamily: "'Fira Code', monospace", color: C.text, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                              {f.content}
                            </pre>
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}

                {/* Notes */}
                {result.notes && (
                  <div style={{ padding: "12px 16px", borderTop: `1px solid ${C.border}`, background: C.blueBg, display: "flex", gap: 8 }}>
                    <span style={{ flexShrink: 0 }}>💡</span>
                    <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.65 }}>{result.notes}</div>
                  </div>
                )}
              </div>
            )}

            {/* Empty state */}
            {!result && !processing && logs.length === 0 && (
              <div style={{ textAlign: "center", padding: "48px 24px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12 }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🤖</div>
                <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Agent siap menerima perintahmu</div>
                <div style={{ fontSize: 13, color: C.muted, maxWidth: 460, margin: "0 auto", lineHeight: 1.65 }}>
                  {connectedCount > 0
                    ? `${connectedCount} akun terhubung. Semua yang agent kerjakan atas nama akunmu.`
                    : "Hubungkan akun di tab Vault agar agent bisa push, deploy, dan query atas namamu."}
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 24 }}>
                  {[
                    "Buat website portfolio dan push ke GitHub",
                    "Deploy landing page ke Vercel",
                    "Buat smart contract ERC-20",
                    "Cek balance ETH wallet ini",
                    "Scaffold app dengan Privy wallet login",
                  ].map((ex, i) => (
                    <button key={i} onClick={() => setCommand(ex)} style={{ padding: "5px 13px", borderRadius: 20, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, cursor: "pointer", fontSize: 11 }}
                      onMouseOver={e => { e.target.style.borderColor = C.purple; e.target.style.color = "#c4b5fd"; }}
                      onMouseOut={e => { e.target.style.borderColor = C.border; e.target.style.color = C.muted; }}>
                      {ex}
                    </button>
                  ))}
                </div>
                {connectedCount === 0 && (
                  <button onClick={() => setActiveTab("vault")} style={{ marginTop: 20, padding: "10px 24px", borderRadius: 9, background: "linear-gradient(135deg, #8b5cf6, #6366f1)", border: "none", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                    🔑 Buka Token Vault
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: #0d1117; }
        ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
        textarea::placeholder { color: #484f58; }
        select option { background: #161b22; color: #e6edf3; }
        input::placeholder { color: #484f58; }
      `}</style>
    </div>
  );
}
