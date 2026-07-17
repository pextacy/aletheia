import { ImageResponse } from "next/og";
import { fetchProject } from "../../../../lib/indexer";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET(_req: Request, { params }: { params: { projectId: string } }) {
  const id = Number(params.projectId);
  const project = Number.isInteger(id) && id > 0 ? await fetchProject(id) : null;

  const title = project?.repoFullName ?? `Project #${params.projectId}`;
  const count = project?.attestationCount ?? 0;
  const first = project?.timeline.find((e) => e.kind === "attestation");
  const firstDate = first ? new Date(first.timestamp * 1000).toISOString().slice(0, 10) : "—";
  const sealed = project?.sealedAt != null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "#faf6ee",
          color: "#1c1a17",
          fontFamily: "serif",
        }}
      >
        <div style={{ fontSize: 28, letterSpacing: 12, color: "#7a2e2e" }}>ALETHEIA</div>
        <div style={{ fontSize: 64, fontWeight: 700, marginTop: 16, maxWidth: 1000 }}>{title}</div>
        <div style={{ display: "flex", gap: 48, marginTop: 40, fontSize: 30, color: "#4a4540" }}>
          <div>{count} attestations</div>
          <div>first seal {firstDate}</div>
          <div style={{ color: sealed ? "#7a2e2e" : "#4a4540" }}>
            {sealed ? "record sealed" : "record open"}
          </div>
        </div>
        <div style={{ marginTop: 48, fontSize: 24, color: "#7a2e2e" }}>
          on-chain build provenance · Monad
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
