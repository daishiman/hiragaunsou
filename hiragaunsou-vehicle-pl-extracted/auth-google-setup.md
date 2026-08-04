# 平賀運送 車両別収支管理システム：Googleログイン設定

作業は3つだけです。目安は10分です。

> [!CAUTION]
> Client IDとClient Secretは、AI・チャット・メール・スクリーンショットへ送らないでください。

## 1. Googleでログイン情報を作る

1. [Google Auth PlatformのClients画面](https://console.cloud.google.com/auth/clients)を会社のGoogleアカウントで開き、対象projectを選びます。
2. 初回設定が表示された場合だけ、アプリ名を`平賀運送 車両別収支管理システム`、Audienceを`Internal`にして保存します。
3. `CREATE CLIENT`を押し、次のとおり設定します。

| 項目 | 設定値 |
|---|---|
| Application type | `Web application` |
| Name | `平賀運送 車両別収支管理システム Web` |
| Authorized JavaScript origins | 空欄 |

`Authorized redirect URIs`へ、次の2件を追加します。

```text
http://localhost:8787/api/auth/callback/google
https://hiragaunsou-vehicle-pl.example.workers.dev/api/auth/callback/google
```

`CREATE`を押し、Client IDとClient Secretが表示された画面を開いたままにします。

> `Internal`が表示されない場合は、`External`を選ばず「Internalが表示されません」と管理者へ伝えてください。

## 2. Terminalで登録する

エディタでこのアプリのフォルダを開き、内蔵Terminalを起動します。次のコマンドを1回実行します。

```bash
node .better-auth-google/setup-secrets.mjs
```

画面の案内に従い、Client IDとClient Secretを1回ずつ貼ってEnterを押します。入力文字が見えないのは正常です。

```text
完了しました。Secretの値は表示・送信していません。
```

この表示が出れば、ローカルとCloudflare本番の登録は完了です。`BETTER_AUTH_SECRET`も自動生成されます。

## 3. ログインを確認する

1. [本番サインイン画面](https://hiragaunsou-vehicle-pl.example.workers.dev/sign-in)を開きます。
2. `Googleで続ける`を押し、`example.co.jp`の管理対象ユーザーでログインします。
3. アプリが開けば完了です。

ログインできるのは`example.co.jp`の管理対象ユーザーです。個人Gmail、別会社アカウント、Google Groupのアドレスはログインできません。

## 止まった場合

Secretは送らず、表示されたエラーメッセージだけを管理者またはAIへ伝えてください。

- `Internalが表示されません`
- `CREATE CLIENTが押せません`
- `redirect_uri_mismatchが出ました`
- `Terminalのコマンドでエラーが出ました`
