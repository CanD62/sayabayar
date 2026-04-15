// apps/scraper/src/lib/flipClient.js
// Thin wrapper — semua implementasi ada di @payment-gateway/shared/flip
// Jika ada update endpoint Flip, EDIT HANYA: packages/shared/src/flip/index.js

export {
  FLIP_HOST,
  CUST_HOST,
  FLIP_URLS,
  decodeJwtPayload,
  getDeviceIdentifier,
  flipHeaders,
  custHeaders,
  parseResponse,
  refreshFlipToken  as refreshToken,
  getAlaflipStatus,
  getAlaflipBalance as saldoAladin,
  getAlaflipBalanceFull,
  getAlaflipWebviewUrl,
  getChargeChallenge as getTokenTransfer,
  executeTransfer   as transferBank,
  getAkunInfo       as infoAkun,
  getBankList,
  checkAccount,
} from '@payment-gateway/shared/flip'
