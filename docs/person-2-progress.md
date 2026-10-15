# Person 2 — Progres implementasi

Rencana lengkap: [person-2-plan.md](./person-2-plan.md). Setiap fase berakhir dengan satu commit di branch `feat/person-2-integration` setelah seluruh kriteria fasenya terpenuhi dan diuji. Status di bawah mencerminkan hasil uji lokal yang benar-benar dijalankan, bukan target.

| Fase | Isi                                                         | Status     |
| ---- | ----------------------------------------------------------- | ---------- |
| 0    | Rencana, baseline lokal                                     | ✅ Selesai |
| 1    | Data model & migrasi (WS1)                                  | ✅ Selesai |
| 2    | Lease, job queue, `ExecutionStore`, `MonitorStore` (WS2)    | ✅ Selesai |
| 3    | ACCE engine & mandate builder (WS5, WS6 bagian murni)       | ✅ Selesai |
| 4    | Auth SIWE & API (WS3, WS4, WS6 bagian API)                  | ✅ Selesai |
| 5    | Verifikasi otorisasi/funding & orkestrasi worker (WS6, WS7) | ✅ Selesai |
| 6    | E2E chain lokal (anvil)                                     | ✅ Selesai |
| 7    | Provider LLM (WS8)                                          | ✅ Selesai |
| 8    | Benchmark runner (WS9)                                      | ✅ Selesai |
| 9    | Dokumentasi, CI, PR                                         | ✅ Selesai |

## Fase 0 — Rencana & baseline

Kriteria:

- [x] Rencana tertulis dan disetujui (`person-2-plan.md`).
- [x] Baseline lokal hijau sebelum perubahan: Foundry 31/31, chain 9/9, worker 11/11, shared 8/8, API 4/4, integrasi PostgreSQL 1/1, ESLint dan Prettier bersih.

Catatan lingkungan: mesin pengembang memakai Node 24, sedangkan repo mengunci Node 22.22 (`engine-strict`). Uji lokal dijalankan dengan memanggil binary langsung; CI tetap memakai Node 22.

## Fase 1 — Data model & migrasi

Migrasi `20261016000000_workflow_and_execution` menambah tabel workflow (`Question`, `PreferenceRecord`, `Executor`, `Mandate`, `Decision`, `ActionProposal`, `PolicyCheck`, `ActivityEvent`), port eksekusi/monitor (`Lease`, `EoaNonceReservation`, `TransactionAttempt`, `AttemptEvent`, `MonitorCursor`, `RiskEvent`) dan evaluasi (`EvaluationRun`, `EvaluationCaseResult`), serta kolom SIWE/CSRF untuk auth.

Kriteria:

- [x] Migrasi berlaku di database yang sudah ada (jalur upgrade) dan di database kosong (jalur CI).
- [x] Tidak ada drift antara database dan `schema.prisma` (`prisma migrate diff` kosong).
- [x] Constraint yang tidak bisa diekspresikan Prisma ada di migrasi: alamat lowercase, hash 0x, batas uint256/uint64/uint32, mask vault/aksi, komponen ordinal ACCE 0–3, budget 5 pertanyaan.
- [x] Partial unique index: satu mandat `AUTHORIZED` per executor, satu aksi non-terminal per executor, EOA nonce aktif unik per operator.
- [x] Tes integrasi PostgreSQL nyata: 5/5 lulus (`pnpm test:integration` sekarang menjalankan semua `tests/*.integration.ts`).
- [x] Typecheck API dan worker, ESLint, Prettier bersih.

Catatan: baris `AuthChallenge`/`AuthSession` lama dikosongkan oleh migrasi karena auth belum pernah diimplementasikan dan datanya sementara.

## Fase 2 — Store durable PostgreSQL

- `packages/database/src/lease.ts`: `LeaseManager` (lease berbasis baris, fencing token monoton, renew otomatis, `LEASE_BUSY` setelah tunggu terbatas) dan `assertFenced` untuk setiap tulis.
- `packages/database/src/jobs.ts`: `enqueueJob` idempotent (outbox, bisa di dalam transaksi workflow) dan `JobQueue` (claim `FOR UPDATE SKIP LOCKED`, lease per job, reclaim setelah crash, retry dengan backoff, `FAILED` setelah `maxAttempts`).
- `apps/worker/src/persistence/`: `PostgresExecutionStore` dan `PostgresMonitorStore` sesuai [worker-chain-port.md](./worker-chain-port.md), raw transaction terenkripsi AES-256-GCM dengan `actionId` sebagai authenticated data.

Kriteria:

- [x] Semua tulis store berfencing; holder yang kedaluwarsa tidak bisa commit (diuji untuk lease, `recordState` dan `commitBatch`).
- [x] Persist-before-broadcast dengan `OperatorExecutionService` asli di atas PostgreSQL; riwayat `AttemptEvent` lengkap.
- [x] Dua worker mengeksekusi aksi yang sama: satu tanda tangan, satu broadcast, satu reservasi nonce.
- [x] Aksi berbeda untuk satu operator mendapat EOA nonce berbeda; reservasi tanpa tanda tangan dari holder yang crash direklamasi, nonce tidak pernah ganda.
- [x] Budget dan interval broadcast bertahan lintas instance store (restart).
- [x] Crash setelah persist → restart mengirim byte identik, lalu `CONFIRMED` dari receipt kanonik tersimpan bersama block number/hash.
- [x] Job queue: claim paralel tidak tumpang tindih, job worker crash direklamasi, owner lama tidak bisa menyelesaikannya, retry habis → `FAILED`.
- [x] Monitor: cursor compare-and-set, rescan overlap tidak menambah job, rewind meng-orphan event dan membatalkan job turunan, event yang kembali kanonik dievaluasi ulang; `RiskEventMonitor` asli lolos scan dan rewind di atas PostgreSQL.
- [x] Tes integrasi: 17/17 lulus tiga kali berturut-turut (tes berbasis timing tidak flaky); unit worker 11/11; DB 5/5; lint, format, typecheck bersih.

Catatan: `pnpm test:integration` di root kini menjalankan tes integrasi semua paket (`pnpm -r --if-present`).

## Fase 3 — ACCE engine & mandate builder

Paket baru `packages/acce` (deterministik, tanpa IO):

- `config.ts`: deskriptor vault v1 (LiquidVault 0 detik/300 bps, TimedVault 30 hari/600 bps) dan empat dimensi dengan komponen ordinal 0–3 berversi (`ACCE_CONFIG_VERSION = v1`).
- `eligibility.ts`: nilai efektif (UNKNOWN → konservatif, belum dijawab → default yang tidak pernah memperluas kewenangan), eligibility per vault dengan alasan, aturan pemilihan PRD §7.2 (TimedVault hanya setelah lockup diterima eksplisit; tie → LiquidVault), deteksi jawaban yang bertentangan.
- `planner.ts`: truth table DecisionFlip atas semua kombinasi dimensi yang belum terjawab, `Score = M × U × F − Friction`, pertanyaan hanya jika skor > 0, budget 5, catatan action disagreement.
- `mandate.ts`: tuple kontrak persis (`mandateTupleSchema` baru di `packages/shared`) dan preview berlabel testnet; hanya vault terpilih yang ditargetkan, `maxLockupSeconds` = lockup vault tersebut, expiry default 7 hari atau minimum lockup + 2 hari untuk TimedVault, maksimum 60 hari; `previewHash` = keccak256 JSON kanonik.
- `wording.ts`: validator untuk teks dari model (ID alternatif tetap, tanpa angka/vault/protokol/alamat/URL/klaim jaminan baru).

Kriteria:

- [x] T01: menolak lockup → 1 pertanyaan, mandat LiquidVault, TimedVault ineligible dengan alasan.
- [x] T02: menerima lockup 30 hari → TimedVault hanya setelah pertanyaan likuiditas; expiry default memenuhi aturan executor.
- [x] T03: "tidak yakin" → konservatif, ditandai "dipersempit", tidak pernah opt-in diam-diam; jawaban bertentangan dipersempit dan dijelaskan.
- [x] Dimensi yang tidak mengubah tindakan (mis. leverage) tidak pernah ditanyakan; budget 5 ditegakkan; jawaban tidak valid/berulang ditolak.
- [x] Mandate builder menolak cap, expiry dan peran yang tidak diizinkan kontrak/PRD; preview hash berubah untuk setiap perubahan isi.
- [x] T13: validator wording menolak angka, alamat, URL, vault/protokol baru dan klaim jaminan.
- [x] Tes: `packages/acce` 19/19, `packages/shared` 8/8; lint dan format bersih.

Catatan: `build:packages` di root dan `Dockerfile` ikut didaftarkan untuk paket baru; lockfile hanya bertambah importer `packages/acce`.

## Fase 4 — Auth SIWE & API

- **Auth** (`apps/api/src/auth/`): challenge EIP-4361 via `viem/siwe` (domain/URI dari `WEB_ORIGIN`, chain 84532, nonce sekali pakai disimpan sebagai hash, kedaluwarsa 5 menit), verifikasi tanda tangan EOA, konsumsi nonce atomik bersama seluruh field, sesi cookie `__Host-boundra_session` (HttpOnly, Secure, SameSite=Strict, 12 jam), token CSRF = HMAC(`SESSION_SECRET`, sessionId). Guard global: sesi untuk semua route non-publik, `Origin` + `X-CSRF-Token` untuk perubahan state, `ADMIN_ADDRESSES` untuk route admin.
- **Rate limit & batas input:** `@nestjs/throttler` (default 120/menit; login 10/menit hanya pada route auth), body JSON maksimum 16 KB, error terstruktur `{ error: { code, message, recovery? } }` dengan kode stabil di `packages/shared`.
- **Endpoint:** `auth/*`, `config/public`, `executors/register`, `intents` (+ `answers`), `intents/:id/mandate-drafts`, `mandate-drafts/:id` (GET/PATCH, `approve`, `authorization-check`), `dashboard`, `activity`, `admin/demo/reset`. OpenAPI di `/api/docs` (non-production).
- **Chain gateway read-only** dari manifest tepercaya; tanpa manifest, fitur chain menjawab `DEPENDENCY_UNAVAILABLE` (bukan data palsu). `OPERATOR_ADDRESS` publik saja; key operator tidak pernah ada di API.
- **`hashMandate`/`sameMandate`** di `packages/chain`, dikunci ke encoding executor oleh test vector Foundry (`contracts/test/MandateHash.t.sol`).
- `pnpm env:setup` kini membuat `SESSION_SECRET` dan `ATTEMPT_ENCRYPTION_KEY`, juga untuk `.env` yang sudah ada (hanya menambah key yang belum ada).

Kriteria:

- [x] Login SIWE: cookie aman, replay ditolak, tanda tangan wallet lain/domain asing/challenge kedaluwarsa ditolak, logout mencabut sesi.
- [x] CSRF: tanpa token, origin lain, atau token sesi lain → 403.
- [x] Isolasi owner: intent owner lain tidak bisa dibaca maupun dijawab (404).
- [x] Validasi intent: nominal nol/desimal, chain salah, field injeksi → 400; nominal di atas saldo yang dapat didanai → 422 sebelum otorisasi; body terlalu besar → 413; JSON rusak → 400.
- [x] Persona A dan B lewat HTTP; draft tanpa executor ditolak; approve dengan preview basi atau revisi lama ditolak; approve mengembalikan transaksi owner persis (`setMandate`, `approve`, `fund`); `authorization-check` meng-enqueue job dan tidak pernah mengubah status menjadi AUTHORIZED.
- [x] Dua jawaban serentak: satu 200, satu 409, satu preference record.
- [x] Admin reset hanya untuk admin, menutup draft/intent terbuka tanpa menghapus riwayat.
- [x] Rate limit login aktif tanpa membatasi route lain.
- [x] API berjalan dari build (`node dist/main.js`) dan dari jalur dev (`tsx`); OpenAPI memuat 18 route.
- [x] Tes: API integrasi 18/18 + unit 4/4, chain 10/10, Foundry 32/32, ACCE 19/19, shared 8/8, worker 11/11 + 17/17, DB 5/5; typecheck semua paket, lint dan format bersih.

## Fase 5 — Verifikasi otorisasi & orkestrasi worker

- `orchestration/decision.ts`: kebijakan agent deterministik (`decide`, `mandateStatus`) sesuai PRD §7.2/§13.1: deposit sekali ke vault terpilih bila dana cukup dan vault NORMAL; DEGRADED → withdraw `min(principal, kapasitas, cap)`; terkunci/kapasitas nol/tanpa izin withdraw → ESCALATE; ESCALATE memblokir deposit baru tetapi tidak recovery; pause → HOLD; revoke/expiry/penggantian on-chain → status mandat berubah, tanpa aksi.
- `orchestration/orchestrator.ts`: `verifyAuthorization` (AUTHORIZED hanya bila tuple on-chain terkonfirmasi sama persis dengan yang di-approve dan versinya belum pernah dipakai), `evaluateMandate` (satu aksi non-terminal per executor, decision log dideduplikasi, `actionId` deterministik sehingga worker paralel bertabrakan di unique constraint, `prepareAction` sebelum proposal, policy check tersimpan), `executeAction` (lewat `OperatorExecutionService`; penolakan sebelum tanda tangan → REJECTED, kegagalan setelah tanda tangan → tetap RECONCILE), `fanOutRisk`, `schedule` (ticker idempotent berbasis bucket).
- `orchestration/job-runner.ts` dan `runtime/`: gate aktivasi tiga mode (`observe_only`, `monitor_only`, `execute`), job runner dengan backoff, shutdown tertib, heartbeat yang melaporkan mode; readiness API kini menampilkan mode worker sebenarnya.

Kriteria:

- [x] FR-05: AUTHORIZED hanya setelah mandat on-chain sama persis; tuple berbeda tetap PENDING; idempotent.
- [x] T04: mandat terotorisasi dan terdanai → proposal deposit, policy check lulus, broadcast, CONFIRMED dari receipt; evaluasi berkala tidak deposit ulang.
- [x] T05: risk event kanonik → evaluasi ulang → withdraw sebatas kapasitas → CONFIRMED; sisa posisi tanpa kapasitas → ESCALATE.
- [x] T06: posisi terkunci saat DEGRADED → ESCALATE, tanpa transaksi.
- [x] T09/T16: revoke dan penggantian mandat on-chain menghentikan agent.
- [x] T15: dana belum masuk → HOLD (dicatat sekali); pause → HOLD.
- [x] Pause setelah proposal ditegakkan saat dispatch: REJECTED, tidak ada tanda tangan, slot executor bebas.
- [x] Tiga worker mengevaluasi bersamaan → tepat satu proposal; job eksekusi berulang → satu broadcast.
- [x] Mode monitor-only tidak pernah mengusulkan transaksi.
- [x] Worker nyata: tanpa manifest → `observe_only`; manifest rusak → aktivasi gagal, tetap hidup, dicoba ulang, tanpa restart loop; heartbeat melaporkan mode.
- [x] Tes: worker unit 18/18, integrasi worker 26/26 (dua kali berturut-turut), API 4/4 + 18/18, shared 8/8, ACCE 19/19; typecheck semua paket, lint dan format bersih.

Catatan: tes integrasi worker kini dijalankan serial (`--test-concurrency=1`) karena berbagi antrean job PostgreSQL yang sama.

## Fase 6 — E2E chain lokal (anvil)

`pnpm test:e2e:chain` (`apps/worker/tests/e2e/full-flow.e2e.ts`) menjalankan seluruh sistem di atas kontrak asli:

1. `anvil --chain-id 84532` (`@foundry-rs/anvil` 1.7.1, versi sama dengan forge), deploy dengan **script deploy Person 1** (artefak broadcast/cache diarahkan ke folder sementara agar tidak menimpa log deploy publik), manifest dengan code hash dari bytecode yang benar-benar ter-deploy.
2. Database PostgreSQL baru yang dimigrasikan dari nol dan dihapus di akhir.
3. API asli lewat HTTP (SIWE, intent, ACCE, register executor, draft, approve) dan worker asli lewat gate aktivasi (`execute`).
4. Wallet owner sendiri menandatangani `claim`, `createExecutor`, `setMandate`, `approve`, `fund`, `revoke`, `ownerWithdraw`; risk admin sendiri menandatangani `setRiskState`.

Kriteria:

- [x] T04: otorisasi diverifikasi on-chain, agent deposit 300 MockUSDC tanpa tanda tangan owner tambahan; receipt sukses dari operator; tx hash di activity sama dengan receipt.
- [x] T07/T08/T10/T11: kontrak menolak deposit kedua (`BudgetExceeded`), target tidak diizinkan (`TargetNotAllowed`), replay action ID (`Replay`), pemanggil bukan operator (`OperatorOnly`), dan operator mengubah mandat (`OwnerOnly`).
- [x] T05: `setRiskState(DEGRADED, 200)` → monitor → withdraw 200 MockUSDC langsung ke wallet owner; sisa 100 tanpa kapasitas → ESCALATE.
- [x] T12 di chain nyata: dispatch pertama crash setelah attempt ditandatangani dan disimpan (`sendCount` 0); worker berikutnya mengirim **byte identik** (tx hash sama), satu reservasi nonce.
- [x] T09/T16: revoke → mandat REVOKED, operator ditolak (`InactiveMandate`); recovery owner mengikuti kapasitas vault (`InsufficientCapacity` lalu berhasil setelah kapasitas pulih); owner kembali memegang 1.000 MockUSDC; tepat dua transaksi agent.
- [x] Lulus dua kali berturut-turut (±40 detik); tidak ada proses anvil maupun database e2e yang tertinggal.
- [x] `createReadOnlyChainClient` kini memakai multicall _deployless_ (tidak bergantung pada Multicall3 yang ter-deploy), diverifikasi ulang di Base Sepolia publik.
- [x] Typecheck worker kini mencakup tes (`tsconfig.e2e.json`); satu kesalahan tipe lama di `execution.test.ts` diperbaiki.

Batas klaim: ini bukti lokal di anvil, bukan transaksi publik Base Sepolia. Bukti publik tetap menunggu deploy Person 1 dan kunci runtime.

## Fase 7 — Provider LLM

Paket baru `packages/llm` (`@anthropic-ai/sdk` 0.131.0):

- `AnthropicProvider`: `client.beta.messages.parse` dengan `betaZodOutputFormat` (output terstruktur tervalidasi Zod), `output_config.effort: "low"`, fallback refusal server-side (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`; tidak dikirim untuk model Haiku yang tidak mendukungnya), deadline 20 detik total (`AbortSignal`), maksimal 3 percobaan, budget token per jam. Model default `claude-opus-5-5`, dapat diganti lewat `LLM_MODEL`. Semua bentuk API diverifikasi dari definisi tipe SDK yang terpasang.
- `DisabledProvider` adalah default (`LLM_PROVIDER=disabled`): teks berasal dari template yang direview dan diberi label `TEMPLATE`.
- `wordQuestion`: model hanya merumuskan ulang pertanyaan yang sudah dipilih planner; hasil divalidasi `validateWording` (ID/urutan alternatif tetap, tanpa angka/vault/protokol/alamat/URL/klaim jaminan baru).
- `summarizeMandate`: ringkasan bahasa biasa untuk preview mandat; hanya boleh menyatakan ulang fakta preview, dan ikut di-hash bersama preview sehingga approval mengikat teks yang dilihat owner.
- API: pertanyaan ACCE memakai provider; sumber teks (`wordingSource`) dan alasan fallback dicatat di activity; preview memuat `plainSummary`.

Kriteria:

- [x] Output model yang valid dipakai dan diberi label `LLM`; request memakai model, effort, fallback, batas token dan deadline yang benar.
- [x] Refusal, output terpotong/malformed, fakta sisipan, alternatif yang diubah, timeout, error provider, budget habis dan provider nonaktif → template, dengan alasan tercatat; alur tidak pernah gagal karena LLM.
- [x] Ringkasan mandat yang mengarang angka atau klaim jaminan ditolak (`GUARANTEE_CLAIM`) dan diganti ringkasan deterministik.
- [x] Lewat HTTP: pertanyaan ber-wording model tetap memakai ID alternatif yang sama; alasan fallback ringkasan tersimpan di activity.
- [x] Tes: `packages/llm` 12/12, ACCE 19/19, API 4/4 + 19/19, E2E anvil 1/1; typecheck, lint dan format bersih.

**Pending (jujur):** belum ada `LLM_API_KEY` di lingkungan ini, jadi belum ada run provider nyata yang tercatat. Semua jalur diuji dengan klien SDK fake. Klaim "generative AI" untuk demo/benchmark membutuhkan run dengan key runtime (PRD §13.2).

## Fase 8 — Benchmark runner B0–B3

Workspace baru `evaluation/` (`@boundra/evaluation`), detail di [evaluation/README.md](../evaluation/README.md):

- `src/fixtures.ts`: schema fixture persona (prompt/nominal publik, preferensi non-negotiable tersembunyi, label kasus, `acceptableActions`, split development/held-out, flag `frozen`).
- `src/runner/simulator.ts`: satu-satunya modul yang membaca label tersembunyi (jawaban persona, persetujuan pada konfirmasi, evaluasi mismatch). Aturan ESLint menolak import simulator/runner/tipe tersembunyi dari `src/baselines/` (dibuktikan dengan percobaan import yang gagal lint).
- `src/baselines/methods.ts`: B0/B1 one-shot (provider LLM, atau `heuristic-stub` berlabel bila tidak ada provider), B2 lima pertanyaan tetap, B3 ACCE; semua memakai mandate builder yang sama.
- `src/runner/run.ts` dan `report.ts`: metrik draft vs approved mismatch, completion, aksi yang dapat diterima, false refusal, tanpa mandat, jumlah pertanyaan (mean/median/max), latensi, token; setiap denominator dilaporkan; laporan JSON + Markdown memuat versi fixture (sha256), config ACCE, deskriptor, prompt dan provider.
- CLI `pnpm benchmark -- --fixture … --split … [--persist]`; `--persist` menyimpan `EvaluationRun`/`EvaluationCaseResult`. Held-out ditolak sampai fixture `frozen`.

Kriteria:

- [x] Simulator menjawab hanya dari preferensi tersembunyi; evaluator mendeteksi pelanggaran lockup/likuiditas/vault/nominal.
- [x] B3 pada persona PRD: A 1 pertanyaan → LiquidVault, B 2 pertanyaan → TimedVault, C "tidak yakin" → LiquidVault, D deskripsi menyesatkan → LiquidVault; tanpa mismatch.
- [x] B2 selalu 5 pertanyaan; B0 mempertahankan draft yang salah, B1 menolaknya di konfirmasi dan menghitungnya sebagai false refusal.
- [x] Tanpa provider, B0/B1 diberi label `heuristic-stub` dan laporan menyatakan bukan hasil AI.
- [x] Held-out hanya pada fixture beku; fixture dengan ID ganda ditolak; denominator nol dilaporkan `null`, bukan 0%.
- [x] CLI menulis laporan dan `--persist` tersimpan di PostgreSQL (diverifikasi lalu dibersihkan).
- [x] Tes: `evaluation` 8/8; lint dan format bersih.

**Pending (jujur):** fixture 50 persona (20 development / 30 held-out) adalah milik Person 3 dan belum ada, jadi **belum ada hasil benchmark yang diklaim**. `fixtures/example-prd-personas.json` hanya contoh untuk menjalankan runner.

## Fase 9 — Dokumentasi, CI dan verifikasi akhir

- Dokumen Person 2: [api.md](./api.md), [acce.md](./acce.md), [data-model.md](./data-model.md) dan kontrak [openapi.json](./openapi.json) (diekspor dari aplikasi, `pnpm --filter @boundra/api openapi:export`). README dan [runbook](./runbook.md) diperbarui (status, mode worker, pemulihan, perintah tes baru).
- CI menjalankan `pnpm test:e2e:chain` setelah tes integrasi.
- Verifikasi akhir dengan toolchain CI (Node 22.22.0 resmi, checksum diverifikasi; pnpm 10.32.1):
  - `pnpm check`: lint, typecheck semua paket, tes unit (Foundry 32, shared 8, ACCE 19, LLM 12, evaluation 8, chain 10, worker 18, API 4) dan build produksi (termasuk web) — lulus.
  - `pnpm test:integration`: database 5, worker 26, API 19 — lulus.
  - `pnpm test:e2e:chain`: alur penuh di anvil — lulus.
  - Playwright web tidak dijalankan ulang karena `apps/web` tidak diubah.

## Ringkasan yang masih terbuka (bukan bagian kode Person 2 yang bisa diselesaikan sendiri)

| Item                                                                  | Pemilik             | Kebutuhan                                       |
| --------------------------------------------------------------------- | ------------------- | ----------------------------------------------- |
| Deploy Base Sepolia, manifest publik, receipt deposit/withdraw publik | Person 1            | Kunci deployer/operator runtime dan gas testnet |
| Run provider LLM nyata yang tercatat                                  | Person 2            | `LLM_API_KEY` runtime                           |
| Fixture 50 persona beku (20 dev / 30 held-out) dan run benchmark      | Person 3 → Person 2 | Fixture dari Person 3                           |
| UI intent/ACCE/preview/funding/dashboard di atas API ini              | Person 3            | `docs/api.md`, `docs/openapi.json`              |
| HTTPS, backup/restore drill, monitoring, soak test 60 menit           | Person 3 (+1/2)     | Host dan domain                                 |
