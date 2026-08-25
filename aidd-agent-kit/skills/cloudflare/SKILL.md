---
name: cloudflare
description: Cloudflare全体の製品選択と対象Accountの文脈を確定するルータースキル。Workers、Pages、KV、D1、R2、Workers AI、Vectorize、Agents SDK、Flagship、Tunnel、WAF、Terraform等のどの製品・参照・専用Skillを使うか判断する。Cloudflare要件が複数製品にまたがる、製品名が未確定、Accountの選択が必要な場合に使う。Wrangler操作、Durable Objects、Turnstile、Email Service、Workersコード、本番デプロイは責務表の専用Skillへ委譲し、本Skillで実行手順を重複定義しない。数値・API・設定は記憶よりCloudflare公式ドキュメントの取得を優先する。
---

# Cloudflare製品選択ルーター

Cloudflareの要件を実装する前に、以下の判断木で対象製品を1つ以上確定し、専用Skillまたは該当製品のreferenceだけを読み込む。本Skillの責務は「何を使うか」と「どのAccountを使うか」の確定までであり、個別製品の実行手順は専用Skillに委譲する。

CloudflareのAPI、型、上限、価格は更新される。**事前知識より最新情報の取得を優先する**。本Skillのreferenceは探索の起点であり、最新仕様の正本ではない。

## 最新情報の取得先

具体的な数値、APIシグネチャ、設定オプションを記載・実装する前に、必ず最新情報を取得する。事前知識や同梱referenceだけで確定しない。

| 取得先 | 取得方法 | 使う場面 |
|--------|----------------|---------|
| Cloudflare docs | `cloudflare-docs` 検索ツールまたは`https://developers.cloudflare.com/` | 上限、価格、API reference、compatibility dates/flags |
| Workers types | `pnpm pack @cloudflare/workers-types`または`node_modules`を確認 | 型シグネチャ、binding形状、handler型 |
| Wrangler config schema | `node_modules/wrangler/config-schema.json` | 設定フィールド、binding形状、許容値 |
| Product changelogs | `https://developers.cloudflare.com/changelog/` | 上限、機能、廃止予定の最新変更 |

referenceと公式docsが食い違う場合は**公式docsを正とする**。特に数値上限、pricing tier、型シグネチャ、設定オプションは必ず再取得する。

## 専用Skillとの責務分担

次の領域は本Skillで実行手順を展開せず、対応する専用Skillをロードする。Account文脈が必要な場合は、本Skillで確定した結果を委譲先へ渡す。

| 要件・作業 | 責務を持つSkill | 本Skillが行うこと |
|---|---|---|
| Wrangler CLIのコマンド、設定、トラブルシュート | `wrangler` | 対象製品とAccount文脈の確定のみ |
| Durable Objectsの設計・実装・テスト | `durable-objects` | Durable Objectsを選ぶべきかの判断のみ |
| Turnstile / CAPTCHA / bot対策 | `turnstile-spin` | Turnstileを選定しAccount文脈を渡す |
| Email Sending / Email Routing / deliverability | `cloudflare-email-service` | Email領域へのルーティングのみ |
| Workersコードの作成・レビュー | `workers-best-practices` | Workersの採用判断と関連製品の選定のみ |
| 本番デプロイ、D1 migration、secret、セキュリティ設定 | `cloudflare-secure-deploy` | 対象Accountと利用製品の確定のみ |

上記以外の製品は、本Skillの判断木から対応する`references/<product>/`だけを読む。別の専用Skillがあるのに、本Skill内の似たreferenceと両方を実行手順として読み合わせない。

## Account文脈の正本

Cloudflareのcreate/update/delete、secret、migration、deployの前に、[Account文脈の自動検出](references/account-context.md)を実行する。特定のrepository名、利用者名、Account名、Account IDを既定値として埋め込まない。

利用者へ最初からAccount情報を尋ねない。プロジェクト設定とread-onlyなCloudflare照合からAccount候補と既存resourceの所有先を自動検出し、次の順で決める。

1. 既存resourceの所有Accountが1つに定まる場合は、そのAccountを自動選択する。
2. 新規projectで既存resourceがない場合は、客観的にチーム用と確認できるAccountを既定推奨する。
3. 根拠が同率の候補が複数残る場合だけ、Account名・種別・一致したresourceを番号付きで示し、番号だけを選んでもらう。

選定結果のmodeは`existing` / `team` / `personal`のいずれかとする。既存resource所有先を選んだ場合は、Account種別を推測せず必ず`existing`にする。`team`既定はresourceが存在しない新規projectだけに適用する。

完全なAccount ID、token、secretはchat、ログ、最終報告、project fileへ出力・保存しない。選択結果はWranglerのdirectory-bound auth profileなど、プロジェクト単位の安全な仕組みで保持する。利用できない場合はsession内だけで扱い、次回は再検出する。CI/CDで資格情報が必要なら`ci-cd-pipeline`へ委譲し、repositoryへ値を書かない。

## 製品選択の判断木

### フィーチャーフラグが必要

```
フィーチャーフラグが必要?
└─ 機能のON/OFF、対象条件、割合配信 → flagship/
   ├─ Workers内で評価 → Flagship binding (env.FLAGS)
   ├─ Node.js / browserで評価 → OpenFeature SDK (@cloudflare/flagship)
   └─ APIでflagを管理 → Flagship REST API
```

### コードを実行したい

```
コードを実行したい?
├─ エッジで動くサーバーレス関数 → workers/
├─ Git連携で公開するフルスタックWebアプリ → pages/
├─ 状態を共有する協調処理/リアルタイム → `durable-objects` Skill
├─ 複数段階の長時間ジョブ → workflows/
├─ コンテナ実行 → containers/
├─ 顧客がコードを公開するマルチテナント → workers-for-platforms/
├─ 定期実行 (cron) → cron-triggers/
├─ HTTPを変更する軽量なエッジ処理 → snippets/
├─ Worker実行イベント（log/observability）の処理 → tail-workers/
└─ backend infrastructureまでの遅延を最適化 → smart-placement/
```

### データを保存したい

```
ストレージが必要?
├─ Key-value（config、session、cache） → kv/
├─ Relational SQL → d1/ (SQLite)またはhyperdrive/ (既存Postgres/MySQL)
├─ オブジェクト/ファイルストレージ (S3-compatible) → r2/
├─ バージョン管理されたファイルツリー（repo、build output、checkpoint） → artifacts/
├─ メッセージキュー（非同期処理） → queues/
├─ Vector embeddings (AI/semantic search) → vectorize/
├─ entity単位の強整合性を持つ状態 → `durable-objects` Skill
├─ シークレット管理 → secrets-store/
├─ R2へのstreaming ETL → pipelines/
├─ R2上のmanaged Apache Iceberg catalog → r2-data-catalog/
├─ Iceberg tableへのserverless SQL analytics → r2-sql/
└─ 長期保持の永続キャッシュ → cache-reserve/
```

### AI/MLを使いたい

```
AIが必要?
├─ 推論 (LLMs, embeddings, images) → workers-ai/
├─ RAG/search用ベクトルDB → vectorize/
├─ 状態を持つAI agent → agents-sdk/
├─ AI provider用Gateway（キャッシュ、ルーティング） → ai-gateway/
└─ AI search widget → ai-search/
```

### ネットワーク/接続が必要

```
ネットワークが必要?
├─ ローカルサービスをインターネットへ公開 → tunnel/
├─ TCP/UDP proxy (non-HTTP) → spectrum/
├─ WebRTC TURN server → turn/
├─ プライベートネットワーク接続 → network-interconnect/
├─ ルーティング最適化 → argo-smart-routing/
├─ backendまでの遅延を最適化（userまでではない） → smart-placement/
└─ real-time video/audio → realtimekit/またはrealtime-sfu/
```

### セキュリティ機能が必要

```
セキュリティ機能が必要?
├─ Web Application Firewall → waf/
├─ DDoS protection → ddos/
├─ botの検出/管理 → bot-management/
├─ API保護 → api-shield/
├─ CAPTCHA代替 → `turnstile-spin` Skill
└─ 資格情報の漏えい検出 → waf/ (managed ruleset)
```

### メディア/コンテンツを扱いたい

```
メディア機能が必要?
├─ 画像の最適化/変換 → images/
├─ 動画の配信/encoding → stream/
├─ browser自動化/screenshot → browser-rendering/
└─ third-party script管理 → zaraz/
```

### 分析/メトリクスを扱いたい

```
分析が必要?
├─ Cloudflare全製品（HTTP、Workers、DNS等）の横断query → graphql-api/
├─ Workersからのcustom high-cardinality metrics → analytics-engine/
├─ client-side (RUM)のperformance data → web-analytics/
├─ Workers Logsとリアルタイムdebugging → observability/
├─ Iceberg data lake（log、event）へのSQL → r2-sql/ (+ pipelines/, r2-data-catalog/)
└─ raw logs（外部ツールへのLogpush） → Cloudflare docs
```

### Infrastructure as Code (IaC)が必要

```
IaCが必要? → pulumi/ (Pulumi)、terraform/ (Terraform)、またはapi/ (REST API)
```

## 製品索引

### フィーチャーフラグ
| 製品 | Reference |
|---------|-----------|
| Flagship | `references/flagship/` |

### コンピュートとランタイム
| 製品 | Reference |
|---------|-----------|
| Workers | `references/workers/` |
| Pages | `references/pages/` |
| Pages Functions | `references/pages-functions/` |
| Durable Objects | `references/durable-objects/` |
| Workflows | `references/workflows/` |
| Containers | `references/containers/` |
| Workers for Platforms | `references/workers-for-platforms/` |
| Cron Triggers | `references/cron-triggers/` |
| Tail Workers | `references/tail-workers/` |
| Snippets | `references/snippets/` |
| Smart Placement | `references/smart-placement/` |

### ストレージとデータ
| 製品 | Reference |
|---------|-----------|
| KV | `references/kv/` |
| D1 | `references/d1/` |
| R2 | `references/r2/` |
| Artifacts | `references/artifacts/` |
| Queues | `references/queues/` |
| Hyperdrive | `references/hyperdrive/` |
| DO Storage | `references/do-storage/` |
| Secrets Store | `references/secrets-store/` |
| Pipelines | `references/pipelines/` |
| R2 Data Catalog | `references/r2-data-catalog/` |
| R2 SQL | `references/r2-sql/` |

### AIと機械学習
| 製品 | Reference |
|---------|-----------|
| Workers AI | `references/workers-ai/` |
| Vectorize | `references/vectorize/` |
| Agents SDK | `references/agents-sdk/` |
| AI Gateway | `references/ai-gateway/` |
| AI Search | `references/ai-search/` |

### ネットワークと接続
| 製品 | Reference |
|---------|-----------|
| Tunnel | `references/tunnel/` |
| Spectrum | `references/spectrum/` |
| TURN | `references/turn/` |
| Network Interconnect | `references/network-interconnect/` |
| Argo Smart Routing | `references/argo-smart-routing/` |
| Workers VPC | `references/workers-vpc/` |

### セキュリティ
| 製品 | Reference |
|---------|-----------|
| WAF | `references/waf/` |
| DDoS Protection | `references/ddos/` |
| Bot Management | `references/bot-management/` |
| API Shield | `references/api-shield/` |
| Turnstile | `references/turnstile/` |

### メディアとコンテンツ
| 製品 | Reference |
|---------|-----------|
| Images | `references/images/` |
| Stream | `references/stream/` |
| Browser Rendering | `references/browser-rendering/` |
| Zaraz | `references/zaraz/` |

### リアルタイム通信
| 製品 | Reference |
|---------|-----------|
| RealtimeKit | `references/realtimekit/` |
| Realtime SFU | `references/realtime-sfu/` |

### 開発ツール
| 製品 | Reference |
|---------|-----------|
| Wrangler | `references/wrangler/` |
| Miniflare | `references/miniflare/` |
| C3 | `references/c3/` |
| Observability | `references/observability/` |
| GraphQL Analytics API | `references/graphql-api/` |
| Analytics Engine | `references/analytics-engine/` |
| Web Analytics | `references/web-analytics/` |
| Sandbox | `references/sandbox/` |
| Workerd | `references/workerd/` |
| Workers Playground | `references/workers-playground/` |

### Infrastructure as Code (IaC)
| 製品 | Reference |
|---------|-----------|
| Pulumi | `references/pulumi/` |
| Terraform | `references/terraform/` |
| API | `references/api/` |

### その他のサービス
| 製品 | Reference |
|---------|-----------|
| Email Routing | `references/email-routing/` |
| Email Workers | `references/email-workers/` |
| Static Assets | `references/static-assets/` |
| Bindings | `references/bindings/` |
| Cache Reserve | `references/cache-reserve/` |

## 選定結果の出力

本Skill自体は製品の実装完了を報告しない。ルーティング完了時に、次の4点を日本語で簡潔に出力し、選定先のSkillまたはreferenceへ引き継ぐ。

1. **選んだCloudflare製品**
2. **選定根拠**（要件のどの部分に対応するか）
3. **使う専用Skillまたはreference**
4. **Account文脈**（`existing` / `team` / `personal`のいずれか。`existing`をteam/personalへ言い換えず、Account IDは表示しない）
