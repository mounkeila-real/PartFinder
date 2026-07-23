import axios from 'axios';

/**
 * Taux de change USD -> EUR, récupéré automatiquement.
 *
 * AliExpress renvoie ses prix en USD ; toute la tarification raisonne en euros.
 * Un taux figé finit par dériver — on le récupère donc en direct (source BCE
 * via Frankfurter : gratuit, sans clé, sans quota), avec cache et repli sur une
 * valeur statique si la source est indisponible.
 *
 * La lecture est SYNCHRONE (utilisée dans le mapping produit) : elle renvoie la
 * dernière valeur connue et déclenche un rafraîchissement en tâche de fond
 * quand elle est périmée, sans jamais bloquer une recherche.
 */

// Repli si l'API n'a jamais répondu. Surchargeable ; ~0.95 par défaut.
const FALLBACK = Number(process.env.ALIEXPRESS_USD_EUR || '0.95');
const TTL_MS = 12 * 60 * 60 * 1000; // 12 h
const SOURCE = 'https://api.frankfurter.app/latest';

let rate: number | null = null;
let fetchedAt = 0;
let inflight = false;

/** Rafraîchit le taux depuis la source. Best-effort, jamais bloquant. */
export async function refreshUsdToEur(): Promise<void> {
    if (inflight) return;
    inflight = true;
    try {
        const r = await axios.get(SOURCE, {
            params: { from: 'USD', to: 'EUR' },
            timeout: 8000,
        });
        const v = r.data?.rates?.EUR;
        // Borne de bon sens : USD->EUR ~ 0.8–1.0. Au-delà, on ignore (donnée
        // aberrante) plutôt que d'appliquer un taux absurde aux prix.
        if (typeof v === 'number' && v > 0.5 && v < 1.5) {
            rate = v;
            fetchedAt = Date.now();
            console.log('[change] USD->EUR =', v);
        } else {
            console.warn('[change] taux USD->EUR hors bornes, ignoré:', v);
        }
    } catch (e: any) {
        console.warn('[change] taux USD->EUR indisponible, repli', FALLBACK, '-', e.message);
    } finally {
        inflight = false;
    }
}

/** Taux USD -> EUR courant (dernier connu, ou repli statique). Synchrone. */
export function getUsdToEur(): number {
    // Périmé : on relance en tâche de fond, mais on répond tout de suite.
    if (Date.now() - fetchedAt > TTL_MS && !inflight) {
        refreshUsdToEur().catch(() => { /* repli déjà géré */ });
    }
    return rate ?? FALLBACK;
}
