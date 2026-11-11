import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { LOGO_LUDOTHEQUE_BASE64 } from "@/lib/logoLudothequeBase64";

// Logo embarqué en base64 (voir logoLudothequeBase64.ts) plutôt que lu
// depuis public/ à l'exécution : un chemin construit via process.cwd()
// faisait planter le build en production (Turbopack le traçait comme un
// dossier à lister plutôt qu'un fichier), jamais reproduit en local.
const LOGO_SRC = `data:image/png;base64,${LOGO_LUDOTHEQUE_BASE64}`;

const styles = StyleSheet.create({
  page: { padding: 56, fontSize: 11, fontFamily: "Helvetica", color: "#1c1917" },
  header: { marginBottom: 32 },
  // Le logo est un bandeau large (icône + texte "Ludothèque Nyon Région"
  // déjà intégré), pas une icône carrée — ratio réel ~3.58:1, le forcer
  // dans un carré l'écrasait.
  logo: { width: 180, height: 50 },
  orgSubtitle: { fontSize: 10, color: "#78716c", marginTop: 6 },
  date: { marginBottom: 24, textAlign: "right" },
  salutation: { marginBottom: 16 },
  paragraph: { marginBottom: 14, lineHeight: 1.5 },
  table: { marginTop: 8, marginBottom: 20, borderTop: "1pt solid #e7e5e4" },
  tableRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottom: "1pt solid #e7e5e4",
  },
  tableRowTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 6,
    fontFamily: "Helvetica-Bold",
  },
  signature: { marginTop: 48 },
  footer: {
    position: "absolute",
    bottom: 32,
    left: 56,
    right: 56,
    fontSize: 8,
    color: "#a8a29e",
    textAlign: "center",
  },
});

export type AttestationData = {
  nom: string;
  annee: string;
  totalMinutes: number;
  parActivite: { nom: string; minutes: number }[];
  genereLe: string; // déjà formatée, ex. "10 novembre 2026"
};

function heures(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

function AttestationDocument({ data }: { data: AttestationData }) {
  return (
    <Document title={`Attestation de bénévolat ${data.annee} — ${data.nom}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- Image ici vient de @react-pdf/renderer (document PDF), pas une balise HTML */}
          <Image src={LOGO_SRC} style={styles.logo} />
          <Text style={styles.orgSubtitle}>Attestation de bénévolat</Text>
        </View>

        <Text style={styles.date}>Nyon, le {data.genereLe}</Text>

        <Text style={styles.salutation}>À qui de droit,</Text>

        <Text style={styles.paragraph}>
          Nous soussignés, la Ludothèque Nyon Région, attestons par la présente que{" "}
          <Text style={{ fontFamily: "Helvetica-Bold" }}>{data.nom}</Text> a exercé une activité
          bénévole au sein de notre association durant l&rsquo;année {data.annee}, pour un total
          de <Text style={{ fontFamily: "Helvetica-Bold" }}>{heures(data.totalMinutes)}</Text>,
          réparties comme suit :
        </Text>

        <View style={styles.table}>
          {data.parActivite.map((a) => (
            <View key={a.nom} style={styles.tableRow}>
              <Text>{a.nom}</Text>
              <Text>{heures(a.minutes)}</Text>
            </View>
          ))}
          <View style={styles.tableRowTotal}>
            <Text>Total</Text>
            <Text>{heures(data.totalMinutes)}</Text>
          </View>
        </View>

        <Text style={styles.paragraph}>
          Cette attestation est délivrée pour servir et valoir ce que de droit.
        </Text>

        <View style={styles.signature}>
          <Text>Nyon, le {data.genereLe}</Text>
          <Text style={{ marginTop: 32 }}>Le Comité de la Ludothèque Nyon Région</Text>
        </View>

        <Text style={styles.footer}>
          Document généré automatiquement à partir des heures enregistrées dans LudoApp.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderAttestationPdf(data: AttestationData): Promise<Buffer> {
  return renderToBuffer(<AttestationDocument data={data} />);
}
