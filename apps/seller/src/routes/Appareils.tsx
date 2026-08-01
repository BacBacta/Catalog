import { Button, Card, CardNote, CardTitle, OfflineState } from "@catalog/ui";
import { useCallback, useEffect, useState } from "react";
import { Ecran } from "../components/Ecran.tsx";
import { type CleEnrolee, clePresumee, listerCles, revoquerCle } from "../lib/cle.ts";

/**
 * Les appareils scelles du compte — ADR 0028.
 *
 * Chaque ligne est une cle WebAuthn. En retirer une deconnecte l'appareil qui
 * la portait, DEFINITIVEMENT : c'est le geste « telephone perdu » — se
 * connecter depuis le nouveau, retirer l'ancien ici.
 *
 * `backedUp` vient de l'authentificateur lui-meme : une cle sauvegardee avec
 * le compte Google suivra la vendeuse sur son prochain telephone, et l'ecran
 * le dit — c'est la reponse a « et si je perds mon telephone ? ».
 */
export function Appareils() {
  const [phase, setPhase] = useState<"chargement" | "liste" | "vide" | "erreur" | "horsLigne">(
    "chargement",
  );
  const [cles, setCles] = useState<CleEnrolee[]>([]);

  const charger = useCallback(async () => {
    setPhase("chargement");
    try {
      const r = await listerCles();
      setCles(r);
      setPhase(r.length ? "liste" : "vide");
    } catch {
      setPhase(typeof navigator !== "undefined" && !navigator.onLine ? "horsLigne" : "erreur");
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  async function retirer(id: string) {
    try {
      await revoquerCle(id);
      await charger();
    } catch {
      setPhase("erreur");
    }
  }

  if (phase === "horsLigne") {
    return (
      <EcranAppareils>
        <OfflineState
          action={
            <Button tone="outline" onClick={() => void charger()}>
              Reessayer
            </Button>
          }
        />
      </EcranAppareils>
    );
  }

  return (
    <EcranAppareils>
      <Card>
        <CardTitle>Appareils scelles</CardTitle>
        <CardNote>
          Chaque appareil a sa propre cle. En retirer un le deconnecte definitivement — c'est le
          geste a faire depuis un nouveau telephone quand l'ancien est perdu.
        </CardNote>

        {phase === "chargement" ? <p className="text-caption text-ink-2">Chargement…</p> : null}

        {phase === "erreur" ? (
          <>
            <p role="alert" className="text-caption text-danger">
              La liste n'a pas pu etre chargee. Reessayez.
            </p>
            <Button tone="outline" onClick={() => void charger()}>
              Reessayer
            </Button>
          </>
        ) : null}

        {phase === "vide" ? (
          <p className="text-caption text-ink-2">
            {clePresumee()
              ? "Aucune cle sur ce compte — celle de ce navigateur a du etre retiree."
              : "Aucun appareil scelle pour l'instant. La proposition apparait apres une connexion."}
          </p>
        ) : null}

        {phase === "liste" ? (
          <ul className="flex flex-col gap-2" style={{ listStyle: "none", padding: 0 }}>
            {cles.map((cle) => (
              <li
                key={cle.id}
                className="flex items-center gap-3 rounded-card border border-control-line p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-body font-semibold">{cle.name ?? "Appareil"}</p>
                  <p className="text-caption text-ink-2">
                    {cle.createdAt
                      ? `ajoutee le ${new Date(cle.createdAt).toLocaleDateString("fr-FR")}`
                      : ""}
                    {cle.backedUp
                      ? " · sauvegardee avec le compte Google"
                      : " · sur cet appareil seulement"}
                  </p>
                </div>
                <Button tone="danger" size="md" onClick={() => void retirer(cle.id)}>
                  Retirer
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </EcranAppareils>
  );
}

function EcranAppareils({ children }: { children: React.ReactNode }) {
  return <Ecran titre="Appareils">{children}</Ecran>;
}
