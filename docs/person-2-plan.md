# Person 2 — Rencana implementasi Backend, ACCE & Data

**Acuan:** [PRD v0.3](../prd.md) (§6, §7, §8, §9.2, §10, §11, §13.1), [task-assignment.md](../task-assignment.md) §4 dan §6, serta handoff Person 1: [worker-chain-port.md](./worker-chain-port.md), [chain-integration.md](./chain-integration.md), [contracts.md](./contracts.md).

**Status:** Rencana, disusun 16 Oktober 2026. Belum ada bagian dari rencana ini yang diimplementasikan. Branch kerja: `feat/person-2-integration` (satu PR bersama perbaikan review modul Person 1).

## 0. Ringkasan

Person 2 membangun semua yang ada di antara wallet pengguna dan modul chain Person 1:

```text
Browser (Person 3)
  │  SIWE login, intent, jawaban ACCE, approve preview
  ▼
API NestJS ──────────────► PostgreSQL ◄────────────── Worker NestJS
  auth, intent, ACCE,        sesi, intent, mandat,       job queue, decision loop,
  mandate draft/preview,     keputusan, aksi, attempt,   verifier, ExecutionStore,
  activity, dashboard        lease, cursor, event, job   MonitorStore
                                                            │
                                    OperatorExecutionService / RiskEventMonitor (Person 1)
                                                            ▼
                                                   Base Sepolia (kontrak Person 1)
```

Jalur kritis menuju demo: **store PostgreSQL → wiring eksekusi → deposit agent di chain lokal → deposit agent publik**. Semua hal lain (ACCE adaptif, LLM, benchmark) dibangun paralel, tetapi tidak boleh menunda jalur kritis.

Prinsip yang tidak boleh dilanggar (dari PRD dan port Person 1):

1. **Chain adalah sumber kebenaran** untuk otorisasi, saldo, posisi dan receipt. PostgreSQL hanya menyimpan workflow dan bukti yang selalu direkonsiliasi ulang.
2. **LLM tidak pernah memutuskan permission.** Ranking, eligibility, verifier dan pemilihan aksi deterministik; LLM hanya merumuskan teks dengan schema tervalidasi dan fallback template.
3. **Tidak ada transaction sender kedua.** Semua transaksi operator lewat `OperatorExecutionService`.
4. **Tidak ada lock database yang ditahan selama panggilan RPC/LLM.** Gunakan lease berbasis baris dengan fencing token.
5. **Nominal selalu exact:** string base-unit di API, `NUMERIC(78,0)` di database, `bigint` di kode. Tidak pernah `Number`.
6. **Tidak ada key owner di server.** Server hanya memegang key operator testnet (dan hanya worker yang membacanya).

## 1. Prasyarat (hari pertama, sebelum menulis fitur)

| #   | Item                                                                                               | Alasan                                                       |
| --- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| P1  | Pasang **Node 22.22.0** (fnm/nvm-windows/Volta)                                                    | `engine-strict` membuat semua script `pnpm` gagal di Node 24 |
| P2  | `pnpm env:setup`, `pnpm db:up`, `pnpm db:migrate`, `pnpm check` hijau                              | Baseline sebelum perubahan                                   |
| P3  | Sepakati dependency baru dengan Person 3 (pemilik lockfile)                                        | Lihat §11                                                    |
| P4  | Minta Person 1: lokasi manifest (`packages/chain/deployments/base-sepolia.json`) dan jadwal deploy | Activation gate worker                                       |
| P5  | Kunci keputusan terbuka di §12                                                                     | Beberapa memengaruhi schema                                  |

## 2. Workstream dan urutan

| WS   | Isi                                                                          | Bergantung pada            | Prioritas                         |
| ---- | ---------------------------------------------------------------------------- | -------------------------- | --------------------------------- |
| WS1  | Data model & migrasi                                                         | —                          | P0, hari 1                        |
| WS2  | Lease, job queue, `ExecutionStore`, `MonitorStore` di PostgreSQL             | WS1                        | P0, jalur kritis                  |
| WS3  | Auth SIWE, sesi, CSRF, isolasi owner, rate limit                             | WS1                        | P0                                |
| WS4  | API REST + OpenAPI (kontrak untuk Person 3)                                  | WS3                        | P0, kontrak dipublikasikan hari 1 |
| WS5  | ACCE engine deterministik + template                                         | — (paket murni)            | P0                                |
| WS6  | Mandate draft/preview, approval, verifikasi otorisasi & funding              | WS4, WS5                   | P0                                |
| WS7  | Orkestrasi agent: decision loop, verifier, eksekusi, risk response           | WS2, WS6                   | P0, jalur kritis                  |
| WS8  | Provider LLM (wording + ringkasan)                                           | WS5                        | P0 untuk klaim AI, bisa menyusul  |
| WS9  | Benchmark runner B0–B3                                                       | WS5, WS8, fixture Person 3 | P1                                |
| WS10 | Config, logging, metrics, dokumentasi (`api.md`, `acce.md`, `data-model.md`) | semua                      | P0 sebagian                       |

## 3. WS1 — Data model & migrasi

Migrasi baru ditambahkan di atas `20261015000001_input_constraints`; tidak ada reset. Semua alamat disimpan lowercase dengan CHECK `^0x[0-9a-f]{40}$`; semua hash `^0x[0-9a-f]{64}$`; semua nominal `NUMERIC(78,0)` dengan CHECK `>= 0` dan `<= uint256 max`.

### 3.1 Perubahan tabel yang ada

| Tabel           | Perubahan                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `AuthChallenge` | + `address`, `domain`, `uri`, `chainId`, `issuedAt`. Nonce tetap disimpan sebagai hash. Dibutuhkan untuk validasi SIWE |
| `AuthSession`   | + `csrfTokenHash`, `lastSeenAt`                                                                                        |
| `Intent`        | + `version` (optimistic concurrency), `descriptorVersion`, `acceConfigVersion`; `state` tetap `WorkflowState`          |
| `Job`           | + `lastError`, `maxAttempts`; partial index untuk claim                                                                |

### 3.2 Tabel baru

| Tabel                                   | Field inti                                                                                                                                                                                      | Constraint penting                                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Executor`                              | ownerId, address, factory, verifiedAtBlock                                                                                                                                                      | unique ownerId, unique address                                                                                            |
| `Question`                              | intentId, questionId, order, dimension, alternatives (JSON), actionDisagreement, materiality/uncertainty/decisionFlip/friction, text, wordingSource (`TEMPLATE`/`LLM`), answerId, status        | unique (intentId, order)                                                                                                  |
| `PreferenceRecord`                      | intentId, dimension, value (JSON atau `UNKNOWN`), source (`ANSWER`/`DEFAULT`/`INPUT`), version                                                                                                  | unique (intentId, dimension, version)                                                                                     |
| `MandateDraft`                          | intentId, ownerId, revision, status, seluruh field tuple kontrak, mandateHash, previewHash, approvedAt, onchainVersion, authorizationTxHash, authorizedBlock, fundedAtBlock, escalatedAt        | satu `AUTHORIZED` per executor (partial unique)                                                                           |
| `Decision`                              | mandateId, kind (`DEPOSIT`/`WITHDRAW`/`HOLD`/`ESCALATE`), reasonCode, reasonSummary, candidates (JSON), snapshotBlock/Hash, policyVersion, actionId?                                            | HOLD berulang yang identik tidak dicatat ulang                                                                            |
| `ActionProposal`                        | actionId (PK), decisionId, executor, onchainVersion, contractNonce, proposalSeq, envelope (JSON, immutable), requestHash, state (`WorkflowState`), rejectionCode                                | unique (chainId, executor, contractNonce, proposalSeq); **maksimal satu aksi non-terminal per executor** (partial unique) |
| `PolicyCheck`                           | actionId, verifierVersion, results (JSON), passed, codes                                                                                                                                        |                                                                                                                           |
| `Lease`                                 | key (PK), holder, fencingToken (BIGINT), expiresAt                                                                                                                                              | dipakai signer lease dan monitor lease                                                                                    |
| `EoaNonceReservation`                   | chainId, operator, eoaNonce, actionId, status (`RESERVED`/`SIGNED`/`RELEASED`), fencingToken                                                                                                    | unique (chainId, operator, eoaNonce) untuk status aktif; unique actionId                                                  |
| `TransactionAttempt`                    | actionId (PK), requestHash, owner, executor, operator, eoaNonce, contractNonce, rawTxCiphertext (BYTEA), txHash, signedAtBlock, state, sendCount, lastSendAt, lastCode, receiptBlockNumber/Hash | unique txHash; unique (chainId, executor, contractNonce)                                                                  |
| `AttemptEvent`                          | actionId, state, code, block, createdAt                                                                                                                                                         | append-only, riwayat audit                                                                                                |
| `MonitorCursor`                         | key (PK), nextBlock, previousBlockHash                                                                                                                                                          |                                                                                                                           |
| `RiskEvent`                             | chainId, txHash, logIndex, blockNumber, blockHash, source, eventRisk/Capacity, currentRisk/Capacity, observedAtBlock(+Hash), status (`CANONICAL`/`ORPHANED`)                                    | unique (chainId, txHash, logIndex)                                                                                        |
| `ActivityEvent`                         | ownerId, intentId?, mandateId?, actionId?, type, payload, txHash?, createdAt                                                                                                                    | append-only, sumber timeline UI                                                                                           |
| `EvaluationRun`, `EvaluationCaseResult` | method, versi fixture/model/prompt/config, metrik, denominator, biaya/latensi                                                                                                                   |                                                                                                                           |

`WorkflowState` di database tetap sinkron dengan `workflowStateSchema` di `packages/shared`.

## 4. WS2 — Store PostgreSQL (jalur kritis)

Semua store diimplementasikan di `packages/database/src/` (repository + raw SQL via `$queryRaw`/`$executeRaw` dalam `$transaction` singkat). Implementasi harus memenuhi kontrak di [worker-chain-port.md](./worker-chain-port.md) kata per kata.

### 4.1 Lease dengan fencing

- **Acquire:** `INSERT … ON CONFLICT (key) DO UPDATE SET holder, fencingToken = fencingToken + 1, expiresAt = now() + ttl WHERE "Lease"."expiresAt" < now() RETURNING fencingToken`. Holder unik per akuisisi (UUID), sehingga dua pemanggilan di proses yang sama pun saling eksklusif.
- **Renew:** timer setiap `ttl/3` memperpanjang `expiresAt` `WHERE fencingToken = milikku`. Jika 0 baris, lease ditandai hilang.
- **`assertHeld()`:** `SELECT` baris dengan fencing milikku dan `expiresAt > now()`.
- **Fencing pada tulis:** setiap mutasi store diawali `SELECT … FROM "Lease" WHERE key=$1 AND "fencingToken"=$2 AND "expiresAt" > now() FOR UPDATE` di transaksi yang sama. Tidak ada baris → `LeaseLost`, transaksi batal.
- **`withSignerLease`/`withMonitorLease`:** coba acquire dengan backoff sampai batas waktu (mis. 30 detik), lalu `LEASE_BUSY` agar job dijadwalkan ulang. Lease dilepas di `finally`.
- TTL default 30 detik; tidak ada transaksi database yang terbuka selama RPC.

### 4.2 `ExecutionStore`

| Metode              | Implementasi                                                                                                                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `findAttempt`       | Baca `TransactionAttempt` + dekripsi raw tx (AES-256-GCM, key dari env `ATTEMPT_ENCRYPTION_KEY`)                                                                                                                                                   |
| `reserveEoaNonce`   | Idempotent per actionId. Reservasi `RESERVED` tanpa attempt dengan fencing lebih lama dari lease saat ini dianggap ditinggalkan dan dilepas (pemilik lama sudah ter-fence). Nonce baru = `max(minimumPendingNonce, reservasi aktif tertinggi + 1)` |
| `saveSignedAttempt` | Insert attempt + ubah reservasi ke `SIGNED` dalam satu transaksi berfencing. Unique constraint menolak duplikat actionId, txHash, EOA nonce, dan contract nonce                                                                                    |
| `reserveBroadcast`  | `UPDATE … SET sendCount = sendCount + 1, lastSendAt = now() WHERE actionId = $1 AND sendCount < $max AND (lastSendAt IS NULL OR lastSendAt <= now() - $interval) RETURNING` → boolean                                                              |
| `recordState`       | Compare-and-set berfencing + baris `AttemptEvent`. Receipt block/hash ikut disimpan                                                                                                                                                                |

Raw transaction tidak pernah masuk log atau response API.

### 4.3 `MonitorStore`

- `readCursor`, `commitBatch(expected, next, observations)`: compare-and-set pada cursor, upsert `RiskEvent` (`ON CONFLICT DO NOTHING RETURNING` untuk mendeteksi event baru), dan **enqueue job evaluasi risiko di transaksi yang sama** dengan key stabil `risk:{txHash}:{logIndex}:{executor}`.
- `rewind(fromBlock)`: set cursor, tandai `RiskEvent` dengan block ≥ from sebagai `ORPHANED`, batalkan job turunan yang masih `PENDING`, semuanya atomik. Aksi yang sudah dikirim tidak dihapus; aksi tersebut masuk rekonsiliasi.

### 4.4 Job queue

- **Claim:** `UPDATE "Job" SET status='RUNNING', leaseOwner, leaseUntil, attempts = attempts + 1 WHERE id IN (SELECT id … WHERE (status='PENDING' AND availableAt <= now()) OR (status='RUNNING' AND leaseUntil < now()) ORDER BY availableAt FOR UPDATE SKIP LOCKED LIMIT $n) RETURNING *`.
- **Complete/fail:** hanya jika `leaseOwner` masih milik worker. Gagal → `availableAt` dengan backoff eksponensial terbatas; melewati `maxAttempts` → `FAILED` + `ActivityEvent`.
- **Enqueue:** selalu dalam transaksi yang sama dengan perubahan workflow (outbox). Key unik membuat enqueue idempotent.
- **Jenis job:** `VERIFY_AUTHORIZATION`, `EVALUATE_MANDATE`, `EXECUTE_ACTION`, `RECONCILE_ACTION`, `EVALUATE_RISK`, `MONITOR_POLL`.
- **SIGTERM:** berhenti meng-claim, tunggu job berjalan selesai sampai batas waktu, lepaskan lease. Aksi in-flight tetap di `RECONCILE`.

### 4.5 Tes integrasi wajib (PostgreSQL nyata)

Dua worker meng-claim job yang sama; lease kedaluwarsa lalu diambil alih (penulis lama ter-fence); crash di antara reservasi/tanda tangan/simpan; crash setelah simpan sebelum broadcast; crash setelah broadcast; dua aksi berebut EOA nonce; overlap rescan monitor tidak menggandakan event/job; rewind meng-orphan event dan membatalkan job turunan. Tes memakai fixture acak dan membersihkan datanya sendiri, seperti `database.integration.ts`.

## 5. WS3 — Autentikasi & isolasi

- **SIWE (EOA)** memakai `viem/siwe` yang sudah tersedia (`createSiweMessage`, `parseSiweMessage`, `verifySiweMessage`); tidak perlu dependency baru.
  1. `POST /auth/challenge {address}` → nonce acak (`generateSiweNonce`), disimpan sebagai hash bersama address, domain, uri, chainId 84532, expiry 5 menit; respons berisi pesan SIWE lengkap.
  2. `POST /auth/verify {message, signature}` → parse, cocokkan domain/uri/chainId/address/expiry dengan challenge, **konsumsi nonce secara atomik** (`UPDATE … WHERE consumedAt IS NULL AND expiresAt > now() RETURNING`), verifikasi tanda tangan, upsert `WalletIdentity`, buat `AuthSession`.
  3. Cookie `__Host-boundra_session` (HttpOnly, Secure, SameSite=Strict, Path=/); token acak, hanya hash yang disimpan; masa berlaku 12 jam.
- **CSRF:** synchronizer token per sesi (hash di `AuthSession`), dikirim di header `X-CSRF-Token` untuk semua request yang mengubah state; ditambah pengecekan `Origin` terhadap allowlist.
- **Isolasi owner:** guard global; semua query privat difilter `ownerId` dari sesi. Alamat owner di body request diabaikan untuk otorisasi.
- **Role demo-admin:** daftar alamat di env `ADMIN_ADDRESSES`; hanya untuk reset data sintetis dan tampilan admin.
- **Rate limit & ukuran input:** `@nestjs/throttler` pada auth, intent/ACCE dan endpoint LLM; batas body JSON (mis. 16 KB).
- **Single origin di dev:** Next.js me-rewrite `/api/*` ke API (koordinasi Person 3), sesuai Caddy di produksi, sehingga cookie tidak lintas origin.
- **Tes:** replay nonce, nonce kedaluwarsa, domain/chain salah, akses lintas owner, CSRF hilang/salah, endpoint admin oleh non-admin.

## 6. WS4 — API REST (`/api/v1`)

Draft OpenAPI dan contoh payload dikirim ke Person 3 **di hari pertama**, sebelum implementasi lengkap, agar UI bisa dibangun paralel memakai mock.

| Method & path                                                                         | Fungsi                                                                                                   |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `POST /auth/challenge`, `POST /auth/verify`, `POST /auth/logout`, `GET /auth/session` | Login SIWE, sesi, token CSRF                                                                             |
| `GET /config/public`                                                                  | Chain ID, alamat dari manifest tepercaya, deskriptor vault berversi, base URL explorer                   |
| `POST /executors/register`                                                            | Server membaca `factory.executorOf(owner)` sendiri dan memverifikasinya; tidak menerima alamat dari body |
| `POST /intents`                                                                       | Buat intent `{objective, amount}`, hitung kandidat, kembalikan pertanyaan pertama atau langsung draft    |
| `GET /intents/:id`                                                                    | State, preferensi, pertanyaan aktif, kandidat eligible beserta alasan                                    |
| `POST /intents/:id/answers`                                                           | Jawab `{questionId, alternativeId}`; hitung ulang kandidat dan pertanyaan berikutnya                     |
| `POST /intents/:id/mandate-drafts`, `PATCH /mandate-drafts/:id`                       | Buat/ubah draft (revisi baru, preview ulang wajib)                                                       |
| `GET /mandate-drafts/:id/preview`                                                     | Preview terstruktur + ringkasan bahasa biasa + `previewHash`                                             |
| `POST /mandate-drafts/:id/approve {previewHash}`                                      | Approve revisi yang dilihat; mengembalikan tuple persis untuk `setMandate`                               |
| `POST /mandate-drafts/:id/authorization-check`                                        | Minta verifikasi on-chain (job); tidak pernah langsung mengubah status                                   |
| `GET /dashboard`                                                                      | Snapshot terkonfirmasi: saldo idle, posisi, status mandat, status risiko                                 |
| `GET /activity?cursor=`                                                               | Timeline: keputusan, policy check, tx, receipt, link explorer                                            |
| `POST /admin/demo/reset`                                                              | Admin saja; hanya data sintetis off-chain                                                                |

Error memakai kode stabil (`ErrorCode` di `packages/shared`) dan langkah pemulihan bila ada. Semua nominal di response berupa string.

## 7. WS5 — ACCE engine

Paket baru **`packages/acce`**: murni TypeScript tanpa IO, dipakai API, worker dan benchmark runner. Diuji dengan Vitest (sesuai PRD §9.1).

### 7.1 Deskriptor dan dimensi

- **Deskriptor vault berversi** (`descriptors/v1`): LiquidVault (lockup 0, latency 0, yield ilustratif 300 bps) dan TimedVault (lockup 2.592.000 detik, tanpa early exit, 600 bps). Alamat diikat dari manifest saat runtime; worker memverifikasi `lockupSeconds`/`illustrativeYieldBps` on-chain saat startup.
- **Dimensi** (sesuai `questionSchema`): `max_lockup_seconds`, `withdrawal_latency_seconds`, `permitted_vaults`, `leverage`. `amount` diambil dari input dan `expiry` dari default yang direview (7 hari, atau lebih panjang jika TimedVault dipilih); keduanya tidak ditanyakan ACCE (PRD §7.1).

### 7.2 Algoritma

1. Hitung eligibility setiap kandidat (DEPOSIT Liquid, DEPOSIT Timed, HOLD) dari hard constraints (PRD §7.2) dengan nilai preferensi saat ini.
2. Untuk setiap dimensi yang belum terjawab, jalankan **truth table**: enumerasi semua jawaban yang mungkin, jalankan aturan pemilihan (§7.2 PRD dan §13.1). `DecisionFlip > 0` hanya jika tindakan terpilih berbeda di antara jawaban.
3. `Score(d) = Materiality × Uncertainty × DecisionFlip − Friction`, komponen integer 0–3 dari config berversi; tie-break urutan ID dimensi.
4. Ajukan satu pertanyaan dengan skor tertinggi; berhenti jika tidak ada dimensi dengan `DecisionFlip > 0` atau budget 5 habis.
5. `UNKNOWN` diperlakukan sebagai nilai paling konservatif (mis. lockup 0) dan ditandai di preview sebagai "dipersempit karena belum yakin". Tidak pernah menjadi opt-in.
6. Kontradiksi (mis. "butuh dana besok" dan "terima lockup 30 hari") → satu pertanyaan klarifikasi; jika tetap bertentangan → `ESCALATE`.

Contoh yang harus terbukti di tes: persona A ("tidak menerima lockup") hanya mendapat 1 pertanyaan, karena setelah TimedVault keluar, tidak ada dimensi lain yang mengubah pilihan. Pertanyaan leverage tidak pernah muncul karena tidak ada vault ber-leverage (`DecisionFlip = 0`).

### 7.3 Wording

Setiap pertanyaan punya template deterministik (Bahasa Inggris untuk UI). LLM opsional hanya merumuskan ulang (WS8). Validator menolak output yang mengubah ID alternatif, menambah angka/alamat/protokol yang tidak ada di template, atau melebihi panjang; penolakan berarti template dipakai, dan sumbernya dicatat (`wordingSource`).

## 8. WS6 — Mandat: draft, preview, otorisasi, funding

- **Draft builder** (di `packages/acce`, deterministik): dari preferensi dan deskriptor → tuple kontrak lengkap. Default sesuai §13.1:
  - `maxDepositPerAction = allocationTarget = maxCumulativeDeposits = amount`;
  - `maxWithdrawPerAction` = seluruh principal;
  - `allowedActions = 3`;
  - `allowedVaults` sesuai eligibility;
  - `maxLockupSeconds` = toleransi yang dijawab;
  - `expiresAt` = 7 hari, atau minimal unlock + 1 hari + margin jika TimedVault;
  - `beneficiary = owner`;
  - operator = alamat operator terkonfigurasi.
- **Preview:** owner, operator, chain, token, target, aksi, beneficiary, cap, budget, expiry, versi, plus cara enforcement setiap preferensi. Juga ditampilkan:
  - "expiry menghentikan operator, bukan membuka lockup";
  - "deposit parsial karena cap menyelesaikan alokasi";
  - "withdraw dibayar langsung ke wallet owner".
    `previewHash` = hash payload preview yang ditampilkan.
- **Approval:** mengikat revisi + `previewHash`. Edit setelah preview membuat revisi baru dan approval ulang.
- **Verifikasi otorisasi (job `VERIFY_AUTHORIZATION`):** snapshot terkonfirmasi → setiap field `snapshot.mandate` harus sama persis dengan tuple yang di-approve, operator benar, `mandateVersion` naik, dan `keccak256(abi.encode(tuple))` sama dengan hash event `MandateSet`. Helper `hashMandate` ditambahkan ke `packages/chain` dengan test vector dari Foundry (dikoordinasikan dengan Person 1). Baru setelah itu status `AUTHORIZED` + `onchainVersion` disimpan.
- **Funding:** dianggap lengkap jika `idleBalance` terkonfirmasi ≥ jumlah deposit yang direncanakan. Agent hanya aktif setelah otorisasi **dan** funding terkonfirmasi.
- **Mandat diganti/dicabut:** jika on-chain berbeda dari yang disimpan (versi baru, revoked, paused, expired), status lokal diperbarui dari chain dan dispatch berhenti.

## 9. WS7 — Orkestrasi agent

### 9.1 Decision loop

Ticker worker meng-enqueue `EVALUATE_MANDATE` dengan key `evaluate:{mandateId}:{floor(now/10s)}` (idempotent lintas worker). Satu evaluasi:

1. Muat mandat `AUTHORIZED` dan executor. Jika ada aksi non-terminal untuk executor ini → enqueue `RECONCILE_ACTION`, selesai (nonce kontrak dibaca dari snapshot 5 blok di belakang, jadi aksi harus serial per executor).
2. `reader.snapshot(owner, executor)`; tolak jika lebih tua dari 30 detik.
3. Rekonsiliasi mandat on-chain vs tersimpan (§8).
4. `decide()` (fungsi murni):
   - **Deposit:** hanya jika `!allocationCompleted`, tidak ada ESCALATE yang belum diselesaikan, vault NORMAL, dan dana idle mencukupi jumlah rencana. Jumlah = `min(allocationTarget, maxDepositPerAction, sisa budget)`. Dana kurang → `HOLD` "menunggu funding" (deposit parsial hanya karena cap yang di-approve, bukan karena dana kurang).
   - **Pilih vault:** TimedVault hanya jika owner eksplisit menerima lockup, vault eligible dan expiry cukup; selain itu LiquidVault (§7.2 PRD).
   - **Risiko DEGRADED + posisi ada:** `WITHDRAW min(principal, maxWithdraw, maxWithdrawPerAction)`. Nol, terkunci atau WITHDRAW tidak diizinkan → `ESCALATE`.
   - Selain itu → `HOLD`.
5. Catat `Decision` (HOLD identik berturut-turut tidak dicatat ulang).
6. Untuk DEPOSIT/WITHDRAW: verifier aplikasi + `prepareAction` dry-run → `PolicyCheck`. Lolos → buat `ActionProposal`:
   - `actionId = keccak256(chainId, executor, onchainVersion, contractNonce, proposalSeq)`; deterministik, jadi dua worker menghasilkan ID yang sama dan unique constraint menghentikan duplikat;
   - deadline = sekarang + 5 menit (≤ expiry);
   - envelope disimpan immutable.
     Enqueue `EXECUTE_ACTION` di transaksi yang sama.

### 9.2 Eksekusi dan rekonsiliasi

`EXECUTE_ACTION`/`RECONCILE_ACTION` memanggil `OperatorExecutionService.execute(owner, executor, envelope)` dengan **envelope tersimpan yang sama persis** (termasuk deadline; `requestHash` mencakup semua field). Pemetaan hasil:

| Hasil                                   | WorkflowState | Tindak lanjut                                                                        |
| --------------------------------------- | ------------- | ------------------------------------------------------------------------------------ |
| `BROADCAST`                             | `BROADCAST`   | `RECONCILE_ACTION` dengan backoff                                                    |
| `CONFIRMED`                             | `CONFIRMED`   | Activity + receipt + link explorer                                                   |
| `REVERTED`                              | `FAILED`      | Alasan; jika kode `NONCE_RELEASE_BROADCAST`, tandai "kedaluwarsa sebelum masuk blok" |
| `RECONCILE`                             | `RECONCILE`   | Rekonsiliasi berulang; tidak ada aksi dependen                                       |
| `ChainPolicyError` sebelum tanda tangan | `REJECTED`    | Kode penolakan di activity                                                           |
| Error lain                              | (tetap)       | Retry job terbatas; habis → `ESCALATED`                                              |

### 9.3 Risiko

`RiskEventMonitor.poll()` dijalankan oleh job `MONITOR_POLL` (satu lease untuk seluruh monitor). `commitBatch` meng-enqueue `EVALUATE_RISK` untuk setiap executor dengan posisi di vault terkait. Evaluasi risiko tidak membaca teks event: selalu snapshot ulang lalu `decide()` (§9.1). Event lama tidak mengalahkan status NORMAL terkini.

### 9.4 Aktivasi

Worker tetap observe-only kecuali semua terpenuhi:

- `EXECUTION_ENABLED=true`;
- manifest tepercaya terbaca dan `verifyDeployment` lolos;
- `OPERATOR_PRIVATE_KEY` ada dan berbeda dari `riskAdmin`;
- batas gas/fee positif;
- `ATTEMPT_ENCRYPTION_KEY` ada.

Kegagalan cek → heartbeat `mode=observe_only` + alasan, tanpa restart loop.

## 10. WS8 — Provider LLM

- **Adapter** `LlmProvider` dengan dua implementasi: `TemplateProvider` (default, `LLM_PROVIDER=disabled`, ditandai bukan AI) dan `AnthropicProvider` (`@anthropic-ai/sdk`).
- **Output terstruktur:** `client.messages.parse()` dengan `output_config: { format: zodOutputFormat(schema) }`, lalu validator WS5 §7.3. Kompatibilitas helper Zod dengan `zod` 4.6 di repo diverifikasi saat instalasi.
- **Model:** default `claude-opus-5-5`, dapat diubah lewat `LLM_MODEL`. Untuk wording singkat pakai `output_config.effort: "low"`. Di model ini thinking tidak bisa dimatikan; effort adalah kontrolnya. Pilihan model yang lebih murah (mis. `claude-haiku-5-5`) adalah keputusan tim (§12).
- **Refusal:** cek `stop_reason` sebelum membaca konten. Aktifkan fallback server-side (`fallbacks: "default"` dengan beta `server-side-fallback-2026-07-01`). Refusal atau output tidak valid → template.
- **Batas waktu & retry:** deadline tahap klarifikasi 20 detik (PRD §10.4); SDK `timeout` dalam milidetik, `maxRetries: 2` (total 3 percobaan, PRD §13.1), semuanya di dalam deadline.
- **Batas biaya:** akumulasi `usage` per sesi dan per run benchmark; melewati `LLM_MAX_TOKENS_PER_SESSION` / batas run → template + catatan di activity/evaluasi.
- **Privasi:** input LLM hanya dimensi, alternatif dan fakta konsekuensi; tanpa alamat, tanpa hidden label, tanpa teks intent mentah jika tidak perlu.

## 11. WS9 — Benchmark B0–B3

Lokasi `evaluation/runner/` dan `evaluation/baselines/` (milik Person 2); fixture dan report milik Person 3.

- **Schema fixture persona** disepakati dengan Person 3 di hari pertama: prompt, preferensi non-negotiable tersembunyi, expected eligibility, label kasus, split dev/held-out.
- **Answer simulator** adalah satu-satunya modul yang membaca label tersembunyi. Modul ini berada di subfolder terpisah, dan ada aturan lint yang melarang modul pembuat mandat meng-import-nya.
- **Metode** memakai mandate builder dan tuple yang sama:
  - B0: LLM one-shot;
  - B1: one-shot + konfirmasi statis;
  - B2: 5 pertanyaan tetap (liquidity, lockup, leverage, amount, permitted vaults);
  - B3: ACCE.
- **Metrik:** mismatch (count/denominator), jumlah pertanyaan (mean/median), completion, false refusal, sesi eskalasi/tanpa mandat terpisah, latensi, token/biaya. Semua run dicatat di `EvaluationRun` dengan versi fixture/model/prompt/config.
- **Prosedur:** held-out dijalankan sekali setelah config dibekukan; tidak ada tuning ulang.

## 12. Keputusan yang perlu dikonfirmasi

| #   | Keputusan                             | Usulan                                                                                                 | Dampak                                                       |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| K1  | Provider & model LLM, API key runtime | Anthropic, `claude-opus-5-5` (configurable)                                                            | WS8, klaim AI di demo                                        |
| K2  | Pemicu risk fixture                   | Admin memanggil `setRiskState` dari **wallet admin di browser**; server tidak memegang key risk admin  | Tidak ada endpoint admin risk dan tidak ada secret tambahan  |
| K3  | Faucet                                | Pengguna memanggil `faucet.claim()` langsung dari wallet; batas sudah ditegakkan kontrak               | Tidak ada endpoint faucet server                             |
| K4  | Deadline aksi                         | 5 menit                                                                                                | Cepat melepas nonce yang macet (perbaikan review Person 1)   |
| K5  | Dev single-origin                     | Rewrite `/api/*` di Next.js (Person 3)                                                                 | Cookie/CSRF sederhana                                        |
| K6  | Paket ACCE                            | `packages/acce` baru (milik Person 2)                                                                  | Struktur workspace                                           |
| K7  | Lokasi manifest                       | `packages/chain/deployments/base-sepolia.json` dari Person 1                                           | Activation gate                                              |
| K8  | Uji end-to-end chain lokal            | `anvil --chain-id 84532` (`@foundry-rs/anvil` 1.7.1, versi sama dengan forge) + deploy script + worker | Bukti deposit/withdraw/crash recovery sebelum testnet publik |

## 13. Dependency baru (perlu persetujuan Person 3)

| Paket                           | Tempat         | Fungsi                                     |
| ------------------------------- | -------------- | ------------------------------------------ |
| `@nestjs/throttler`             | api            | Rate limit                                 |
| `cookie` (atau `cookie-parser`) | api            | Parsing cookie sesi                        |
| `supertest` (dev)               | api            | Tes HTTP                                   |
| `@anthropic-ai/sdk`             | api/evaluation | Provider LLM                               |
| `vitest` (dev)                  | acce           | Tes unit (sudah dipakai `packages/shared`) |
| `@foundry-rs/anvil` (dev)       | root/contracts | Chain lokal untuk tes end-to-end           |

Semua dipin exact sesuai `saveExact`.

## 14. Jadwal

Mengikuti milestone [task-assignment.md](../task-assignment.md) §7. Urutan gate lebih penting daripada tanggal.

| Hari       | Target                                                                                                                                                 | Gate selesai                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **16 Okt** | Prasyarat; WS1 migrasi; WS2 lease + job queue + `ExecutionStore` + `MonitorStore` + tes integrasi; draft OpenAPI & schema fixture ke Person 3          | Tes konkurensi/crash store hijau di PostgreSQL nyata; Person 3 punya kontrak API        |
| **17 Okt** | WS3 auth; WS4 endpoint inti; WS5 ACCE (template); WS6 draft/preview/approve/verifikasi; WS7 wiring eksekusi; e2e anvil: approve → fund → deposit agent | Deposit agent sukses di anvil lewat worker; satu deposit publik setelah Person 1 deploy |
| **18 Okt** | WS7 risk response, withdraw/escalate, revoke; WS8 LLM; WS9 runner + dev set; tes T05–T16                                                               | Risk exit/escalation + blocked attempt + satu run benchmark dev                         |
| **19 Okt** | Bekukan config; run held-out; soak 60 menit (restart worker + event duplikat); `docs/api.md`, `acce.md`, `data-model.md`                               | CI hijau, angka benchmark asli dengan denominator                                       |
| **20 Okt** | Verifikasi hasil dan bukti; tidak ada fitur baru                                                                                                       | QA akhir                                                                                |

**Jika terlambat, urutan pemangkasan:** dashboard metrik dan reset demo dahulu, lalu rephrase LLM (template tetap jalan dan diberi label). **Tidak boleh dipangkas:** fencing/lease, verifikasi otorisasi on-chain, rekonsiliasi, isolasi owner, dan pelaporan kegagalan benchmark.

## 15. Strategi pengujian (pemetaan skenario PRD §11.2)

| Skenario                                           | Lapisan uji                                                 |
| -------------------------------------------------- | ----------------------------------------------------------- |
| T01–T03 (lockup ditolak/diterima, UNKNOWN)         | Unit `packages/acce` + API e2e                              |
| T04 deposit                                        | E2e anvil (worker nyata, PostgreSQL nyata)                  |
| T05–T06 risk + lockup                              | E2e anvil (time travel hanya lokal)                         |
| T07–T11 (target/cap/expiry/replay/authority salah) | Foundry (Person 1) + verifier unit + satu e2e penolakan     |
| T12 timeout + restart                              | Integrasi store + e2e anvil dengan worker dibunuh di tengah |
| T13 prompt injection                               | Unit validator ACCE/LLM                                     |
| T14 event palsu/duplikat, LLM gagal                | Integrasi monitor store + unit provider                     |
| T15 approval ditolak/dana kurang                   | API e2e + decision unit                                     |
| T16 revoke + recovery                              | E2e anvil                                                   |

Tambahan: dua worker paralel memproses mandat yang sama, race revoke-vs-execute, database tidak tersedia, provider LLM mati.

## 16. Risiko

| Risiko                           | Mitigasi                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| Jadwal 4 hari sangat padat       | Jalur kritis didahulukan; pemangkasan sesuai §14                                              |
| Deploy publik Person 1 terlambat | E2e anvil sebagai bukti lokal berlabel; deposit publik segera setelah manifest ada            |
| Rate limit RPC publik            | Multicall + cache verifikasi (sudah di branch ini); RPC berbayar sebagai cadangan             |
| Hash mandat off-chain ≠ on-chain | Test vector dari Foundry sebelum dipakai; perbandingan field-per-field sebagai pengaman kedua |
| Biaya/latensi LLM                | Effort rendah, deadline 20 detik, batas token, fallback template                              |
| Kebocoran label benchmark        | Batas modul + lint + review Person 3                                                          |

## 17. Definition of done Person 2 (dipetakan dari task-assignment §4)

- [ ] OpenAPI dan shared schema stabil, dipakai frontend dan worker.
- [ ] API + worker + PostgreSQL tanpa state in-memory sebagai sumber persisten.
- [ ] Tes auth, ACCE, verifier, workflow, konkurensi dan crash lulus di PostgreSQL nyata.
- [ ] LLM nyata terintegrasi; fallback diberi label.
- [ ] Benchmark 50 persona (20 dev / 30 held-out) dengan hasil asli, termasuk kegagalan.
- [ ] `docs/api.md`, `docs/acce.md`, `docs/data-model.md` tersedia.
