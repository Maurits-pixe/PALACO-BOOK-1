import { mentorRegistry } from "../src/domain/mentors";

const knowledge = [
  ["LC-000001", "De Levensader", "SYSTEM", "VERIFIED", "Blue Book v0.1"],
  ["LC-000002", "Mentor Council contract", "CONTRACT", "IN REVIEW", "mentor-contract-v0.1"],
  ["LC-000003", "Knowledge Card model", "MODEL", "CONCEPT", "PALACO masterplan"],
];

const mentors = [
  ["M01", "Evidence", "Bronnen & provenance", "READY"],
  ["M02", "Context", "Casuscontext", "READY"],
  ["M03", "Dissent", "Tegenspraak", "WAITING"],
];

function Status({ children, tone = "blue" }: {
  children: React.ReactNode;
  tone?: "blue" | "gold" | "green";
}) {
  return <span className={`status ${tone}`}><i aria-hidden="true" />{children}</span>;
}

export default function Home() {
  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Hoofdnavigatie">
        <a className="brand" href="#top" aria-label="PALACO dashboard">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span><strong>PALACO</strong><small>LEVENSADER</small></span>
        </a>
        <nav>
          <p>Werkruimte</p>
          <a className="active" href="#top"><span>⌂</span>Dashboard</a>
          <a href="#kennis"><span>◉</span>Levensader</a>
          <a href="#case"><span>◇</span>Casussen</a>
          <a href="#mentorraad"><span>◎</span>Mentorraad</a>
          <a href="#audit"><span>≡</span>Audit & provenance</a>
        </nav>
        <div className="sidebar-foot">
          <Status tone="green">SYNTHETIC ALPHA</Status>
          <p>AI adviseert.<br />De mens beslist.</p>
        </div>
      </aside>

      <div className="workspace" id="top">
        <header className="topbar">
          <div><p className="eyebrow">PALACO BLUE BOOK · v0.1-alpha</p><h1>Goedemorgen, Palaco</h1></div>
          <div className="top-actions">
            <label className="search"><span aria-hidden="true">🔎</span><input type="search" placeholder="Zoeken in de Levensader" aria-label="Zoeken in de Levensader" /><kbd>⌘ K</kbd></label>
            <button className="avatar" type="button" aria-label="Profiel">MB</button>
          </div>
        </header>

        <section className="hero" aria-labelledby="hero-title">
          <div>
            <Status>KENNISSTROOM ACTIEF</Status>
            <h2 id="hero-title">De Levensader</h2>
            <p>Een inspecteerbaar kennislandschap voor bronnen, casussen, relaties en mentorobservaties.</p>
            <div className="actions"><a className="button primary" href="#kennis">Bekijk kennis</a><a className="button secondary" href="#audit">Open audit trail</a></div>
          </div>
          <div className="source-visual" aria-label="Visualisatie van de kennisstroom">
            <span className="orbit a" /><span className="orbit b" /><span className="orbit c" />
            <span className="source-core"><i />LEVENSADER<small>bron · context · bewijs</small></span>
          </div>
        </section>

        <section className="metrics" aria-label="Kernstatus">
          <article><span>Kennisobjecten</span><strong>12</strong><small>3 bijgewerkt deze week</small></article>
          <article><span>Open reviews</span><strong>3</strong><small className="gold-text">Menselijke beoordeling vereist</small></article>
          <article><span>Brondekking</span><strong>83%</strong><small>10 van 12 gekoppeld</small></article>
          <article><span>Auditstatus</span><strong className="word">Inspecteerbaar</strong><small>Append-only trace actief</small></article>
        </section>

        <div className="content-grid">
          <section className="panel" id="kennis" aria-labelledby="knowledge-title">
            <div className="panel-head"><div><p className="eyebrow">DE LEVENSADER</p><h2 id="knowledge-title">Recente kennis</h2></div><a href="#kennis">Alles bekijken →</a></div>
            <div className="knowledge-list">
              {knowledge.map(([id, title, type, state, source]) => (
                <article key={id}>
                  <span className="object-icon" aria-hidden="true">{type[0]}</span>
                  <div><small>{id} · {type}</small><h3>{title}</h3><p>Bron: {source}</p></div>
                  <Status tone={state === "VERIFIED" ? "green" : state === "IN REVIEW" ? "gold" : "blue"}>{state}</Status>
                </article>
              ))}
            </div>
          </section>

          <aside className="panel case-panel" id="case" aria-labelledby="case-title">
            <div className="panel-head"><div><p className="eyebrow">ACTIEVE CONTEXT</p><h2 id="case-title">Case Alpha-01</h2></div><Status tone="gold">IN REVIEW</Status></div>
            <p className="summary">Synthetische casus voor de verticale Levensader-keten. Geen productie- of gezondheidsdata.</p>
            <dl>
              <div><dt>Actor</dt><dd>OWNER / MB</dd></div><div><dt>Intentie</dt><dd>Inspectie</dd></div>
              <div><dt>Scope</dt><dd>SYNTHETIC_ALPHA</dd></div><div><dt>Beslissing</dt><dd>Mens vereist</dd></div>
            </dl>
            <a className="text-link" href="#audit">Bekijk context en grenzen →</a>
          </aside>
        </div>

        <section className="command-center" id="mentorraad" aria-labelledby="council-title">
          <div className="command-head">
            <div><p className="eyebrow">DARK MODE · OPERATIONELE WERKRUIMTE</p><h2 id="council-title">Mentor Council</h2><p>{mentorRegistry.length} geregistreerde slots · observatie zonder verborgen autoriteit</p></div>
            <Status>ADVISORY · HUMAN DECISION REQUIRED</Status>
          </div>
          <div className="command-grid">
            <div className="council-map" aria-label="Mentor Council relaties">
              <span className="council-ring one" /><span className="council-ring two" />
              <div className="hub"><span>ROUTER</span><strong>Synthese</strong><small>niet de beslisser</small></div>
              {mentors.map(([id, name], index) => <div className={`mentor-node node-${index + 1}`} key={id}><span>{id}</span><strong>{name}</strong></div>)}
            </div>
            <div className="mentor-list">
              {mentors.map(([id, name, role, state]) => (
                <article key={id}><span className="mentor-avatar">{id}</span><div><strong>{name}</strong><small>{role}</small></div><Status tone={state === "READY" ? "green" : "gold"}>{state}</Status></article>
              ))}
              <div className="dissent"><span>!</span><p><strong>Dissent behouden</strong>Mentor M03 vraagt om extra broncontrole vóór synthese.</p></div>
            </div>
          </div>
        </section>

        <section className="panel trace-panel" id="audit" aria-labelledby="trace-title">
          <div className="panel-head"><div><p className="eyebrow">RECONSTRUEERBARE KETEN</p><h2 id="trace-title">Provenance & audit</h2></div><Status tone="green">TRACE INTACT</Status></div>
          <ol className="trace">
            {["Case aangemaakt", "Bron gekoppeld", "Knowledge Object v0.1", "Mentorobservaties", "Safety review", "Audit event"].map((step, index) => (
              <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong><small>{index < 3 ? "PERSISTED" : index < 5 ? "ADVISORY" : "APPEND-ONLY"}</small></li>
            ))}
          </ol>
          <p className="integrity"><strong>Source ≠ Analysis ≠ Conclusion.</strong> Iedere laag blijft afzonderlijk inspecteerbaar.</p>
        </section>

        <footer><span>PALACO · LEVENSADER Visual System v0.1</span><span>Private preview · Geen productieclaim</span></footer>
      </div>
    </main>
  );
}
