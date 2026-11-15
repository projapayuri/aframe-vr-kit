# A-Frame VR Kit

Author: **projapa** · Version: **0.2.0**

A-FrameでGLBアバターの操作・視点・アニメーション・距離判定を扱うJavaScriptライブラリです。必要な段階で共有空間への接続を追加できます。A-Frame Gesture Handsとは独立しています。

## このリポジトリに含めるもの

```text
aframe-vr-kit/
├── vr-kit.js
├── vr-shared.js
└── README.md
```

- `vr-kit.js`：一人での操作・アニメーション・距離判定。
- `vr-shared.js`：共有するときに追加するブラウザ用ライブラリ。

デモHTML・GLB・画像・A-Frame本体・サーバー・テスト・作業ログは同梱しません。以下のコードはREADME内の使用例です。授業ではバージョンを固定して読み込んでください。

## CDNで読み込む

A-Frameを先に読み込み、その後にvr-kit.jsを読み込みます。

```html
<script src="https://aframe.io/releases/1.6.0/aframe.min.js"></script>
<script src="https://cdn.jsdelivr.net/gh/projapayuri/aframe-vr-kit@v0.2.0/vr-kit.js"></script>
```

一人で使う場合は`vr-kit.js`だけで動きます。共有するときは、下記「共有空間への接続」の順序で`vr-shared.js`も読み込みます。

## 読み込みと最小構成

A-Frame 1.6.0を先に読み込みます。以下は、ライブラリをCDNから読み込み、自分で用意した`robot.glb`をHTMLと同じフォルダへ置く例です。アニメーション名とscaleは使用するGLBに合わせて変更してください。HTMLはLive ServerまたはNode.jsサーバーから開きます。

```html
<script src="https://aframe.io/releases/1.6.0/aframe.min.js"></script>
<script src="https://cdn.jsdelivr.net/gh/projapayuri/aframe-vr-kit@v0.2.0/vr-kit.js"></script>

<a-scene>
  <a-sky color="lightblue"></a-sky>
  <a-plane rotation="-90 0 0" width="30" height="30" color="darkseagreen"></a-plane>
  <a-entity id="playerAvatar" gltf-model="robot.glb"
    position="0 0 -3" scale="0.3 0.3 0.3"
    avatar="cameraFollow: true; avatarDirection: 180;
            walk: Robot_Walking; idle: Robot_Wave"></a-entity>
</a-scene>
```

`avatar`はカメラ1つ・操作対象1体で使います。`a-camera`は省略できます。`fov`を明示したカメラはその値を使い、省略時はvr-kitが60にします。HUDや取得数の表示は学生のコードで作ります。一人での操作・取得にはSocket.IOやNode.jsサーバーは不要です。

## avatarの全オプション

すべて実行中にも`setAttribute`で変更できます。`position`・`scale`・`gltf-model`はA-Frame側の属性で、この表のオプションとは別です。

| オプション | 既定値 | 内容 |
| --- | --- | --- |
| `view` | `third` | `first`は一人称、`third`は三人称。省略すると三人称 |
| `enabled` | `true` | `false`でキー移動・旋回・ドラッグを止める。再開時はキーを押し直す |
| `moveSpeed` | `1` | 移動速度の倍率。2で従来の2倍、0.5で半分、0で移動停止。旋回速度とは別 |
| `avatarDirection` | `0` | GLB固有の前向きの補正角度。カメラや通信する体の向きには加えない |
| `faceMovement` | `true` | カメラ追従なしの三人称で、体を移動方向へ向けるか |
| `cameraFollow` | `false` | 三人称で体の背中へ追従するか。一人称では値にかかわらず体の向きで見る |
| `turnSpeed` | `120` | 一人称と追従する三人称のキー旋回速度（度/秒）。0でキー旋回停止 |
| `eyeHeight` | `1.6` | 一人称の目の高さ。足元からのm。GLBのscaleには連動しない |
| `cameraOffset` | `0.6 2 3` | 三人称の右・上・後ろの距離。追従中は体を基準にする |
| `lookHeight` | `1.1` | 三人称カメラが見つめる、足元からの高さ |
| `walk` | 空文字 | 移動中に再生するGLB内のアニメーション名。空文字なら再生しない |
| `idle` | 空文字 | 停止中に再生するGLB内のアニメーション名。空文字なら再生しない |

一人称と`cameraFollow: true`の三人称は、A/D・←/→で旋回、W/↑で前進、S/↓で後退します。左右だけならその場で回り、後退しても体は反転しません。追従なしの三人称は従来どおりA/Dで横方向へ移動し、ドラッグでカメラを回します。キーを離すと移動・旋回が止まります。

### 実行中に変更する

```javascript
const playerAvatar = document.getElementById("playerAvatar");

playerAvatar.setAttribute("avatar", "moveSpeed", 2);
playerAvatar.setAttribute("avatar", "enabled", false);
playerAvatar.setAttribute("avatar", "enabled", true);
playerAvatar.setAttribute("avatar", "view", "first");
playerAvatar.setAttribute("avatar", "cameraOffset", "0 2 4");
playerAvatar.setAttribute("avatar", "lookHeight", 1.5);
playerAvatar.setAttribute("avatar", "avatarDirection", 180);
playerAvatar.setAttribute("avatar", {
  walk: "Robot_Running",
  idle: "Robot_Idle"
});
```

一人称では三人称用の設定を変えても視点は動かず、三人称へ戻したときに反映されます。`view`の切り替えでは足元の位置と体の向きを保ちます。HUDの表示・ボタンの処理は自動生成しません。

## 開始位置と向きに戻す

```javascript
function retry() {
  resetAvatar(playerAvatar);
}
```

`avatar`を準備した時点の位置・向きへ戻します。キー入力・速度・ドラッグ状態をクリアし、一人称の上下の視線も正面へ戻します。現在のモデル、scale、視点、カメラ設定、enabledは保ちます。成功時は`true`、未準備・対象の誤りは日本語の案内を出して`false`を返します。通常はモデル表示後のボタンから呼べます。

カウント・タイマー・アイテムの取得済み状態は学生のコードで戻します。共有アイテムの所有権や得点を変更する機能ではありません。共有接続中なら戻った足元・向きが通常の位置同期で相手へ伝わります。

## アニメーションと読み込み失敗

GLB読み込み完了時に、Consoleへファイルのパスとアニメーション名の一覧を表示します。`avatar`がない配置モデルも対象で、通信で生成した相手のモデルは除きます。アニメーションなしの場合も案内します。

完全な名前（例：`RobotArmature|Robot_Walking`）をそのまま`walk`・`idle`へ指定できます。`|`以降の名前がそのGLB内で一意なら、`Robot_Walking`という短い名前も使えます。指定名が存在しない、または短縮名が重複すると、日本語で完全な名前を確認するよう案内します。GLB読み込み失敗時は、ファイルの場所と大文字／小文字を確認する案内を出します。

`avatar-motion`も引き続き使えます。配置した動物などには`avatar-motion="target: #deer; idle: Idle"`と指定できます。操作対象の`avatar`に設定したwalk・idleを変更した場合は、その要素の`avatar-motion`にも反映します。既存の授業コードで直接`avatar-motion`を変更する方法も維持しています。

## 距離による判定

```javascript
if (isNear(playerAvatar, item, 1)) {
  item.setAttribute("visible", false);
}
```

`isNear(first, second, distance = 2)`は、同じシーンの2要素のワールド座標での原点間距離が指定値以下なら`true`です。親の移動・回転・拡大を考慮します。無効な要素・距離は`false`です。GLBの表面の衝突判定、壁での停止、重力は含みません。非表示の要素も判定対象なので、取得済みの変数で繰り返し取得を防ぎます。

## 共有空間への接続

`vr-shared.js`はブラウザ側だけの機能です。使用する際は、対応したNode.js・Socket.IOサーバーを別途用意します。このリポジトリだけで共有サーバーは起動できません。

対応サーバーからHTMLを配信する場合の読み込み順です。`/socket.io/socket.io.js`はそのサーバーが配信します。

```html
<script src="https://aframe.io/releases/1.6.0/aframe.min.js"></script>
<script src="/socket.io/socket.io.js"></script>
<script src="https://cdn.jsdelivr.net/gh/projapayuri/aframe-vr-kit@v0.2.0/vr-kit.js"></script>
<script src="https://cdn.jsdelivr.net/gh/projapayuri/aframe-vr-kit@v0.2.0/vr-shared.js"></script>
```

```javascript
const playerAvatar = document.getElementById("playerAvatar");
const socket = vrConnect(playerAvatar, { room: "main" });
```

`vrConnect`は対応サーバーの`/vr-kit/models.json`からモデル一覧を取得し、同じ配信元のSocket.IOへ接続します。サーバー側のモデル一覧と、HTMLで使用するGLBが対応している必要があります。1タブを1接続として扱います。名前やアカウントの登録機能はありません。

| API | 内容 |
| --- | --- |
| `socket.on("connect", showConnected)` | 自分の接続完了。`socket.id`でIDを読む |
| `socket.on("disconnect", showDisconnected)` | 自分の切断 |
| `socket.on("count", showCount)` | 部屋の接続数 |
| `socket.on("player-joined", showPlayer)` | 相手の情報。途中参加時は既存の相手も通知 |
| `socket.on("player-left", showPlayer)` | 退室した相手の`{ id }` |
| `socket.on("player-moved", showPlayer)` | 相手の`{ id, x, y, z, yaw }` |
| `socket.emit("take-item", item.id)` | 取得をサーバーへ要求 |
| `socket.on("score", showScore)` | サーバーで確定した自分の取得数 |
| `socket.on("item-taken", showResult)` | `{ room, id, playerId, count }` |
| `socket.on("items-ready", showItems)` | 初期同期の`{ room, items, count }` |

`showCount`などは自分で書く関数名の例です。相手の生成・削除、初期同期、位置・向きの同期、補間、再接続をライブラリが担当します。共有アイテムはサーバーで先に届いた有効な要求だけを取得として確定し、全画面の表示と取得者の数を更新します。アイテムのID・座標・取得距離は対応サーバーに設定します。

現在の共有教材は同じモデルと初期設定を各画面で使う構成です。参加者ごとに異なるGLBやクリップ設定を共有中に切り替えて配信する機能は含みません。移動・向き・リセット後の位置は共有します。

## バージョンと確認範囲

ブラウザのConsoleで`VR_KIT_VERSION`を読むと`0.2.0`を確認できます。授業では`@v0.2.0`のように特定のリリースを指定したURLで読み込んでください。更新時は新しいバージョンを用意し、公開済みのタグは変更しません。

別管理のローカル開発環境で、Chromeによる操作・モデル切り替え・距離判定・設定変更・リセット・一人用取得・共有を検証しています。テストコードや画像はこの公開候補には含めません。20接続シミュレーションは20台実機の検証とは別です。学校LAN・複数PC・VRヘッドセットは未確認です。

このライブラリ本体の公開ライセンスは未設定です。
