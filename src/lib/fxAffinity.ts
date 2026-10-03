/**
 * Playlist-affinity tags that make an FX sound eligible for Spooky Music.
 * While that playlist is active, transition FX and ambient loops are chosen
 * only from FX carrying one of these (see store.requestAiFxPick and
 * DualDeckStage's ambientLoopPool), so uploads meant for it must carry them.
 */
export const HALLOWEEN_AFFINITY = ["spooky", "halloween"];
