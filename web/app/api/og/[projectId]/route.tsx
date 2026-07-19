import { ImageResponse } from "next/og";
import { fetchProject } from "../../../../lib/indexer";
import { CHAIN_NAME } from "../../../../lib/chain";

export const runtime = "nodejs";
export const revalidate = 300;

const OBSIDIAN = "#0f0a1a";
const SURFACE = "#161121";
const FUCHSIA = "#ff0df5";
const FUCHSIA_SOFT = "#ffabef";
const CYAN = "#00eefc";
const INK = "#e9def6";
const MUTED = "#dcbed3";
const OUTLINE = "#564051";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const id = Number(projectId);
  const project = Number.isInteger(id) && id > 0 ? await fetchProject(id) : null;

  if (!project) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: OBSIDIAN,
            color: INK,
          }}
        >
          <div style={{ fontSize: 26, letterSpacing: 10, color: FUCHSIA_SOFT }}>ALETHEIA</div>
          <div style={{ fontSize: 56, fontWeight: 800, marginTop: 20 }}>No such project</div>
          <div style={{ fontSize: 26, marginTop: 12, color: MUTED }}>
            #{projectId} is not registered on chain
          </div>
        </div>
      ),
      { width: 1200, height: 630 }
    );
  }

  const title = (project.repoFullName ?? `Project #${project.projectId}`).toUpperCase();
  const first = project.timeline.find((e) => e.kind === "attestation");
  const firstDate = first ? new Date(first.timestamp * 1000).toISOString().slice(0, 10) : "—";
  const sealed = project.sealedAt != null;
  const statusColor = sealed ? FUCHSIA : CYAN;
  const statusText = sealed ? "SEALED" : "ATTESTED";

  const card = (label: string, value: string, sub: string, accent: string) => (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "rgba(26,20,41,0.7)",
        borderLeft: `4px solid ${accent}`,
        border: `1px solid ${OUTLINE}`,
        borderRadius: 8,
        padding: "24px",
      }}
    >
      <div style={{ fontSize: 15, letterSpacing: 2, textTransform: "uppercase", color: MUTED }}>
        {label}
      </div>
      <div style={{ fontSize: 34, color: INK, marginTop: 10 }}>{value}</div>
      <div style={{ fontSize: 14, color: accent, marginTop: 6 }}>{sub}</div>
    </div>
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: `linear-gradient(135deg, ${SURFACE} 0%, ${OBSIDIAN} 70%)`,
          color: INK,
          padding: "64px",
        }}
      >
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 10,
                background: FUCHSIA,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 30,
                color: "#51004d",
                fontWeight: 800,
              }}
            >
              A
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 6, color: INK }}>
              ALETHEIA
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              border: `1px solid ${statusColor}`,
              borderRadius: 999,
              padding: "10px 24px",
            }}
          >
            <div style={{ width: 12, height: 12, borderRadius: 999, background: statusColor }} />
            <div style={{ fontSize: 18, letterSpacing: 4, color: statusColor }}>{statusText}</div>
          </div>
        </div>

        {/* project name */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 20, letterSpacing: 6, color: CYAN }}>PROTOCOL VERIFICATION</div>
          <div
            style={{
              fontSize: title.length > 22 ? 64 : 84,
              fontWeight: 800,
              color: INK,
              letterSpacing: -2,
              marginTop: 8,
              display: "flex",
            }}
          >
            {title}
          </div>
        </div>

        {/* metrics */}
        <div style={{ display: "flex", gap: 24 }}>
          {card("First sealed", firstDate, `PROJECT #${project.projectId}`, FUCHSIA_SOFT)}
          {card(
            "Attestations",
            String(project.attestationCount),
            sealed ? "RECORD SEALED" : "RECORD OPEN",
            CYAN
          )}
          {card("Owner", `${project.owner.slice(0, 6)}…${project.owner.slice(-4)}`, "ON MONAD", FUCHSIA_SOFT)}
        </div>

        {/* footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 16, color: MUTED }}>{`on-chain build provenance · ${CHAIN_NAME}`}</div>
          <div style={{ fontSize: 16, color: FUCHSIA_SOFT, letterSpacing: 2 }}>ALETHEIA.PROOF</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
