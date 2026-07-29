import { formatXaf } from "@swap/contracts";

// Squelette de la phase 1. Les quatre etats obligatoires de chaque ecran —
// chargement, vide, erreur, HORS LIGNE — seront cables au lot 5 ; le mode hors
// ligne n'est pas optionnel ici, il est aussi frequent que le mode connecte.
export function Dashboard() {
  return (
    <main style={{ maxWidth: "34rem", margin: "0 auto", padding: "2rem 1.25rem" }}>
      <p
        style={{
          fontSize: "var(--text-caption)",
          color: "var(--color-muted)",
          letterSpacing: ".08em",
          textTransform: "uppercase",
        }}
      >
        Squelette phase 1
      </p>
      <h1 style={{ fontSize: "var(--text-title)", margin: ".4rem 0 1rem" }}>Espace vendeuse</h1>
      <div
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-line)",
          borderRadius: "var(--radius-card)",
          padding: "1rem",
        }}
      >
        <div style={{ fontSize: "var(--text-caption)", color: "var(--color-muted)" }}>
          Soldes a encaisser
        </div>
        <div style={{ fontSize: "var(--text-hero)", fontWeight: 800 }}>{formatXaf(12250)}</div>
      </div>
    </main>
  );
}
