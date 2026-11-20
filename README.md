# A-Frame VR Kit

Author: **projapa** · Version: **0.3.5**

v0.3.5をGitHubとjsDelivrで公開しています。公開済みのv0.3.4・v0.3.3・v0.3.2・v0.3.1・v0.3.0・v0.2.0も引き続き使えます。授業では下記のバージョン固定URLを使ってください。

A-FrameでGLBアバターの操作・視点・アニメーション・距離判定・すり抜け防止を扱うJavaScriptライブラリです。必要な段階で共有空間への接続を追加できます。A-Frame Gesture Handsとは独立しています。

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
<script src="https://cdn.jsdelivr.net/gh/projapayuri/aframe-vr-kit@v0.3.5/vr-kit.js"></script>
```

一人で使う場合は`vr-kit.js`だけで動きます。共有するときは、下記「共有空間への接続」の順序で`vr-shared.js`も読み込みます。

## 読み込みと最小構成

A-Frame 1.6.0を先に読み込みます。以下は、ライブラリをCDNから読み込み、自分で用意した`robot.glb`をHTMLと同じフォルダへ置く例です。アニメーション名とscaleは使用するGLBに合わせて変更してください。HTMLはLive ServerまたはNode.jsサーバーから開きます。

```html
<script src="https://aframe.io/releases/1.6.0/aframe.min.js"></script>
<script src="https://cdn.jsdelivr.net/gh/projapayuri/aframe-vr-kit@v0.3.5/vr-kit.js"></script>

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
| `collisionRadius` | `0.35` | solidに対する本人の半径（m）。GLBや親のscaleには連動しない |
| `stepHeight` | `0.25` | walkableで上り下りできる高さの差（m） |
| `maxSlope` | `45` | walkableで登れる傾斜の上限（度） |
| `groundOffset` | `0` | 地面から足元の高さ補正（m） |
| `idleWhenBlocked` | `false` | solidに押し当てて停止中もwalkを維持。trueならidleへ戻す |
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

## 移動とキー入力の判定（0.3.0）

```javascript
if (isMoving(playerAvatar)) {
  // 実際に移動中。
}
if (!isMoving(playerAvatar)) {
  // 停止中。isIdleという別の関数は不要。
}
if (!isMoveKeyPressed(playerAvatar)) {
  // WASD・矢印キーを1つも押していない。
}
```

どちらも`avatar`を付けた操作対象のA-Frame要素を渡し、true／falseを返します。

| 状態 | isMoving | isMoveKeyPressed |
| --- | --- | --- |
| 前進・後退・左右移動 | true | true |
| solidに押し当てて足踏み | false | true |
| その場でキー旋回 | false | true |
| 速度0、または反対方向のキーを同時押し | false | true |
| キーを離して停止 | false | false |

`isMoving(element)`は、衝突処理後の足元のワールド座標を毎フレーム比較し、速度が0.05m/秒を超えた場合にtrueです。カメラやGLBの見た目のアニメーションでは判定しません。同じフレームなら繰り返し呼んでも同じ状態を読めます。移動開始・停止は次のフレームで反映し、リセットによる移動はカウントしません。

`isMoveKeyPressed(element)`はW/A/S/D・上下左右の矢印キーのどれかが押されていればtrueです。旋回・solidでの停止・速度0・反対キー同時押しも含みます。`avatar.enabled: false`ではfalseです。マウスドラッグは含みません。

未準備・対象違い・削除済み・操作対象の一時停止中は両方false。リセット・操作無効化・シーン一時停止で入力と移動状態をクリアします。配置したNPCや通信相手の一般的な移動検出用ではなく、自分が操作するavatar向けです。

キーを離している間だけメーターを減らす例です。meter要素をa-sceneの外へ置きます。

```html
<meter id="chargeMeter" min="0" max="100" value="100"></meter>
```

```javascript
let charge = 100;
const chargeMeter = document.getElementById("chargeMeter");

function updateCharge() {
  if (!isMoveKeyPressed(playerAvatar)) {
    charge = Math.max(0, charge - 1);
  }
  chargeMeter.value = charge;
}

setInterval(updateCharge, 100);
```

移動中に減らしたい場合は、条件を`isMoving(playerAvatar)`へ変えます。赤い箱の近くで停止している条件は`!isMoving(playerAvatar) && isNear(playerAvatar, box, 2)`です。チャージ量・増減・メーター更新は学生のコードで扱います。


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

## 1回だけ再生し、最後の姿勢を保つ（0.3.0）

`avatar-motion`の`clip`にクリップ名を指定すると、移動によるwalk/idleの切り替えより優先して、その動きを再生します。

```javascript
wolf.setAttribute("avatar-motion", {
    clip: "Death",
    loop: "once",
    clampWhenFinished: true
});
```

このwolf.glbの倒れるクリップ名は`Death`です。任意のGLBではConsoleで実在する名前を確認してください。clipの完全一致を優先し、完全名がない場合だけ「|の後の短い名前が一意」のときに使います。

| avatar-motionの設定 | 既定値 | 内容 |
| --- | --- | --- |
| `clip` | 空文字 | 再生するクリップ名。指定中はwalk/idleの変更やtargetの移動で上書きしない |
| `loop` | `repeat` | repeatは繰り返し、onceは1回だけ |
| `clampWhenFinished` | `false` | trueなら1回再生の最後の姿勢を保持。falseなら再生後に元の姿勢へ戻る |
| `paused` | `false` | trueで現在の再生位置を一時停止。falseで同じ位置から再開 |

宝箱は`Chest_Open`の先頭が閉じた状態です。pausedで先頭に待たせ、初めて近づいたら再生します。追加のchest用JSは必要ありません。

```html
<a-entity id="chest" gltf-model="chest.glb"
  position="1.5 0 -7" scale="0.7 0.7 0.7"
  avatar-motion="clip: Chest_Open; loop: once;
    clampWhenFinished: true; paused: true"></a-entity>
```

```javascript
let opened = false;
function checkChest() {
    if (opened === false && isNear(avatar, chest, 2)) {
        opened = true;
        chest.setAttribute("avatar-motion", "paused", false);
    }
}
setInterval(checkChest, 100);
```

上のJavaScriptでは既存のavatarとchestの要素取得を使います。設定はavatarではなく、相手モデルのavatar-motionへ渡します。openedやfallenなどの変数で「一度反応した」ことを覚え、離れたときに元のクリップへ戻すelseは書きません。同じ設定を繰り返し渡しても再生位置は巻き戻りません。

pausedの切り替えは再生位置を保ちます。clampで完了した動きをpaused falseにしただけで、先頭から再生し直すことはありません。サンプルの「最初から」は再読み込みで変数とモデルを初期化します。resetAvatarは人物の位置を戻す機能なので、宝箱の状態は初期化しません。

clipを空文字にすると、従来のwalk/idle自動切り替えへ戻れます。clip/loop/clampWhenFinishedを変更したときは再生を設定し直します。clip指定中にwalk/idleだけを変えても、完了姿勢を上書きしません。

再生終了時に`vr-animation-finished`イベントを1回通知します。`event.detail`のclip/state/clampedを読み、終了後の処理に使えます。通知時には最終フレームの姿勢が反映されています。ループ再生・途中でのクリップ変更では終了通知を出しません。モデルの読込・クリップ名の不備は、これまでと同様にConsoleへ案内します。

通常の移動モデルは設定を追加しなければ、従来どおりwalk/idleを繰り返します。新機能でNPCの位置・向き・衝突・死亡状態を自動で同期することはありません。

## solidですり抜けを防ぐ（0.3.0）


```html
<a-box position="0 0.5 -6" color="blue" solid></a-box>

<!-- GLBもsolidだけで、大きさとscaleに判定が追従する。 -->
<a-entity gltf-model="./models/wolf.glb" position="3 0 -7"
  scale="0.45 0.45 0.45" solid></a-entity>
```

`solid`を付けた配置アイテムは、操作中の`avatar`の進路を止めます。ロボットでもオオカミでも操作方法は同じです。後退や横への回り込みは可能です。高速移動では移動前後を結ぶ線分も調べ、途中の障害物を飛び越えないようにします。

| solidのオプション | 既定値 | 内容 |
| --- | --- | --- |
| `radius` | 省略で自動 | 明示したときだけ手動の円（原点中心、ワールドm）。通常は指定不要 |
| `enabled` | `true` | falseなら通れる。実行中の変更とsolid属性の取り外しにも対応 |

v0.3.5から、`solid`だけなら表示中のモデルを囲む箱を自動取得し、そのXZ範囲で止めます。GLBの元の大きさ・原点のずれ・position・rotation・scale・親の変換・子メッシュの配置を反映します。実行中のscaleやモデルの変更にも追従するので、大きさを変えるたびに半径を指定し直す必要はありません。`ground`との併用も可能です。未読込やメッシュなしの間は、自動判定を待ちます。

これはワールドのX/Z軸に平行な外枠（AABB）の簡易判定です。回転した物は外枠が広がり、空洞・入口・屋根の下の空間も箱の内側として扱います。アバターの半径ぶん外側で止め、角にも少し余裕を持たせます。上下の高さで通り抜けを区別する物理判定ではありません。マップ全体にsolidを付けると空き地も含む外枠が1つの障害物になるため、建物や動物など個別に配置した物に付けます。動物のスキンアニメーションは、最初の姿勢の外枠を基準にして、歩行ごとに判定が揺れないようにします。モデルや親のscaleはその後も反映します。

手動の円が必要な場合だけ、従来どおり`solid="radius: 0.8"`を指定できます。この指定はワールドのmで固定する上書きで、scaleに連動しません。`item.removeAttribute("solid", "radius")`で自動へ戻せます。配置時は重ならない位置に置きます。最初から重なっている場合でも近い外側へ出る移動は可能です。

`visible: false`（親を含む）・`solid="enabled: false"`・削除したアイテムは障害物から外れます。取得で非表示にした後は通れます。自分自身やその子に付けたsolidは自分の障害物にはしません。配置した動物・独自コードで動かすNPC・通信相手同士を自動で押し戻す機能は含みません。停止位置は従来どおり共有できますが、solidの設定や状態自体を同期する機能はありません。

既定では、移動キーを押して障害物で止まっている間も`walk`を続けます。キーを離すと`idle`へ戻ります。停止したらIdleにしたい場合だけ次を追加します。

```html
<a-entity gltf-model="./models/robot.glb" scale="0.3 0.3 0.3"
  avatar="avatarDirection: 180; walk: Robot_Walking; idle: Robot_Wave;
          idleWhenBlocked: true"></a-entity>
```

```javascript
playerAvatar.setAttribute("avatar", "idleWhenBlocked", true);
playerAvatar.setAttribute("avatar", "collisionRadius", 0.4);
item.setAttribute("solid", "radius", 0.6);
item.setAttribute("solid", "enabled", false);
```

横滑りなど実際に移動していればtrueでもwalkを再生します。旋回だけ・操作無効・速度0ではidleです。両方の半径は0以上の有限な数値で指定し、不正な値は日本語で案内して直前の有効な値を使います。

`isNear()`は従来どおり**3Dの原点間距離**を返し、非表示の要素も対象にします。solidとは別の判定です。餌や取得の距離は、solidで止まる距離と原点の高さの差も考慮して設定してください。


## 地面の範囲から出ないようにする（0.3.0）

```html
<a-plane id="field" rotation="-90 0 0" width="30" height="30"
  color="darkseagreen" movement-area></a-plane>
```

水平なa-planeに`movement-area`を付けると、操作中のavatarがその幅・高さの範囲から出ないように止まります。プレイヤーの`collisionRadius`も考慮します。中央にある30m四方の地面と既定半径0.35mなら、足元はおよそX/Zの±14.65mまで移動できます。端に向かってキーを押し続けても進まず、端に沿った移動や内側へ戻る移動は可能です。移動前後の線分で判定するので、高速移動でも端を飛び越えません。solidの障害物と併用できます。

平面や親の移動・水平回転・scale、実行中のwidth／height変更を反映します。範囲は平面に追従し、本人の半径はワールド座標のm指定のままです。判定は床面のXZ上で行い、重力・ジャンプ・斜面歩行・高さの自動補正は行いません。斜めや垂直の平面、本人が収まらない小さな平面は日本語で案内して使いません。GLBの輪郭が必ず全て地面内へ収まる判定ではありません。

開始位置は範囲内に置きます。範囲を縮めるなどして既に外にいる場合、さらに外へ出る移動は止め、内側へ戻る移動は許可します。自動でテレポートはしません。

| movement-areaのオプション | 既定値 | 内容 |
| --- | --- | --- |
| `enabled` | `true` | falseなら範囲制限を外す |

```javascript
const field = document.getElementById("field");
field.setAttribute("movement-area", "enabled", false);
field.setAttribute("movement-area", "enabled", true);
field.setAttribute("width", 40);
```

非表示（親を含む）・無効化・属性を外した平面は制限から外れます。有効な範囲は1シーンで1枚です。複数ある場合は最初の有効な平面を使って案内を出します。複数の地面の結合や、離れた足場の乗り移りは扱いません。

端で停止中も既定では移動入力に合わせてwalkを維持し、`idleWhenBlocked: true`でidleへ戻せます。端に押し当てている間は`isMoving(avatar)`がfalse、`isMoveKeyPressed(avatar)`がtrueです。沿って移動している間は両方trueです。対象は自分のavatarで、NPCや通信相手の移動を自動で制限しません。


## 地面の高さに足元を合わせる（0.3.0）

```html
<a-entity gltf-model="./terrain.glb" walkable></a-entity>
```

`walkable`を地形に付けると、操作中の`avatar`が足元付近の表面を調べ、高さを合わせます。a-plane・a-boxなどの形状や、子に地面を含むa-entityにも使えます。複数の地面を指定できます。属性がなければ従来どおり水平に移動します。家具まで地面扱いしたくない場合は、床・坂だけの要素に付けてください。


### 最初の高さ合わせは自動

```html
<a-entity gltf-model="./sabaku.glb" position="0 0 0" scale="1 1 1" walkable></a-entity>
```

`walkable`の`autoAlign`は既定でtrueです。モデルを読み込むと、avatarの**開始位置のX/Z**にある登れる面を調べ、その面が開始時の足元の高さに来るよう、地形要素をワールドの上下方向へ移動します。最初の高さ合わせはstepHeightの範囲に制限されません。大きさは学生がscaleで調整し、Y座標の数値合わせはライブラリへ任せられます。上のファイル名は授業フォルダの砂漠モデルを使う例です。

- 複数の高さの面がある場合は、元の足元の高さに近い、maxSlope以内の面を選びます。屋根・床・水・茂みの意味を自動判別する処理ではありません。開始点は地面のあるX/Zに置いてください。
- 自動で高さを合わせる主地形は1つです。複数の床や坂を一緒に動かしたい場合は、1つのa-entityへまとめてwalkableを付けます。追加のwalkable面は元の配置を保ち、通常の足元判定には使われます。
- 通常歩行・停止・リセットでは地形を再配置しません。地形のposition・rotation・scaleやメッシュが変わると、開始位置を基準に再確認します。モデルの大きさや配置を編集中は「開始位置に戻る」で確認してください。
- 地形が未読込、開始位置のX/Zに面がない、急斜面しかない場合は自動で横へ移動せず、移動を止めて案内します。初回後の通常歩行には従来のstepHeight・maxSlopeの制限を使います。

| walkableの設定 | 既定値 | 内容 |
| --- | --- | --- |
| `enabled` | `true` | 地面として使うか |
| `autoAlign` | `true` | 主地形の高さを開始時の足元へ自動で合わせるか |

手で高さを指定する教材では、最初から`walkable="autoAlign: false"`を指定します。その場合は従来どおり、足元と地面をstepHeight以内に配置してください。実行中にfalseにしても、補正済みの位置を元へ戻す処理はしません。

| avatarのオプション | 既定値 | 内容 |
| --- | --- | --- |
| `stepHeight` | `0.25` | 一度に上り下りできる高さの差（m）。0以上 |
| `maxSlope` | `45` | 登り下りできる面の傾斜（度）。0以上90未満 |
| `groundOffset` | `0` | 地面に対する足元の高さの補正（m）。GLBの原点に応じて調整 |

```html
<a-entity gltf-model="./man.glb" position="0 0 1" scale="0.32 0.32 0.32"
  avatar="stepHeight: 0.25; maxSlope: 45; groundOffset: 0.01;
    walk: HumanArmature|Man_Walk; idle: HumanArmature|Man_Idle"></a-entity>
```

モデルのファイル名・scale・位置・アニメーションは使用するGLBに合わせます。上は授業フォルダのman.glbを使う例です。`groundOffset`以外の2項目は距離・角度の上限で、人物のscaleには連動しません。3項目とも`setAttribute("avatar", "stepHeight", 0.2)`などで実行中に変更できます。不正な値は直前の有効値を使います。

- 開始位置のX/Zに地面があれば、最初の高さは自動で合わせます。autoAlignをfalseにした場合だけ、開始位置の足元と地面をstepHeight以内に合わせてください。地面の読み込み前や、開始点に面がない場合は移動を止めてConsoleで案内します。
- 緩い坂は高さに沿って移動し、小さな段差では高さを即座に合わせます。高い段差・急斜面・足元に面がない場所では止まります。落下・重力・ジャンプ・左右の足のIK・カメラの壁判定はありません。
- 足元から近い高さだけを探すため、遠く上にある屋根へ突然上がりません。ただし、低い家具・茂み・水面もwalkableのモデルに含めれば候補になります。川を通行禁止にする機能ではありません。建物の壁や家具には別途solidを配置してください。
- 原点にある足元1点で地面を調べます。人物の半径全体の接地保証はありません。8cm間隔で経路を確認するため、それより細い亀裂や障害物は省略される場合があります。1フレームの調査は128区間までで、それを超える移動は手前で止めます。
- `solid`・水平な`movement-area`と併用できます。障害物と地面の端が同時に干渉する場合は、そのフレームの開始点で止めます。地形に押し当てて止まったときも、既定はWalkを維持し、`idleWhenBlocked: true`でIdleに戻ります。`isMoving`は高さを含む実移動を返します。
- 地面・親・子のvisible、walkableのenabled、属性の削除、モデルの読み込み後のメッシュ、親の位置・回転・scaleを反映します。`walkable="enabled: false"`で一時的に対象から外せます。対象を全て外すと高さ補正と地形の端での停止を解除します。
- 対象は`avatar`で操作する自分です。NPC・通信相手を地形へ追従させません。変形するスキンメッシュや移動する足場に乗せる用途は対象外です。重いモデルでは床・坂だけの簡単な判定用モデルを用意すると軽くできます。

## NPCを地面の高さに合わせる（0.3.4）

```html
<a-entity id="map" gltf-model="assets/sabaku.glb"
  position="0 0 0" scale="0.1 0.1 0.1" walkable></a-entity>

<a-entity gltf-model="assets/horse.glb"
  position="-3 0 -7" scale="0.5 0.5 0.5"
  ground="#map" avatar-motion="idle: Idle"></a-entity>
```

`ground="#map"`を付けたモデルは、X・Zにある地形を高さ0として、`position`のYを「地面からの高さ（m）」として使います。Yが0なら接地、0.5なら地面から0.5m上、-0.3なら地面から0.3m下です。地形のGLB読み込みと、walkableによる開始時の高さ合わせをライブラリ側で待つため、配置用のJavaScriptは不要です。馬・宝箱・建物などに使えます。v0.3.3ではYを上書きしていましたが、v0.3.4では指定したYを補正値として残します。Yが0の既存コードの見た目は同じです。

斜面上の家を地面から0.3m下げる例です。scaleが10でも補正は0.3mです。

```html
<a-entity gltf-model="assets/cabin.glb" position="-8 -0.3 12"
  scale="10 10 10" ground="#map"></a-entity>
```

- `walkable`はプレイヤーが歩く地形の指定、`ground`は配置したNPCの高さ合わせです。walkableを付けても、ほかのGLBすべてを移動させることはありません。groundを付けないモデルは手書きのYを使います。
- 地面として指定した要素の静的なメッシュを上から調べ、傾斜45度以内の最上面へ合わせます。範囲外・未読込・非表示・walkable無効などで面が見つからない間は、モデルの表示とsolidの判定を待ちます。X/Zを地形内へ移すなど、条件が変わると再配置します。
- X/Zを変更すると移動先の地面へ合わせ、Yを変更すると地面からの高さを変更します。`el.setAttribute("position", "-8 -0.3 12")`のようにX・Y・Zを指定して調整できます。`el.getAttribute("position")`には指定した相対Yが残るため、読み出したpositionで横へ移動しても補正は蓄積しません。地形のposition・scaleなどの変更やモデルの再読み込みにも対応します。X/Zは親からの配置、Yの補正はワールドの上下方向のmです。モデル自身や親のscaleを変えても、0.5の補正は0.5mです。内部のグループで接地分を補い、positionの数値は書き換えません。実際のワールド位置は`el.object3D.getWorldPosition(new THREE.Vector3())`で取得でき、isNearやsolidもその位置を使います。ボーンのアニメーションはそのまま再生できます。
- 要素自身の`visible`は変更しません。取得後に`visible="false"`にしたアイテムを勝手に表示することはありません。groundを外すと、その時点の位置から通常の手動配置へ戻ります。
- 原点がモデルの中心にある場合や、斜面上の建物の端が浮く場合は、positionのYで補正してください。建物の幅全体ではなく原点の下の1地点を調べるので、斜面へ少し埋める調整に使います。傾斜への体の回転・足ごとのIK・重力・経路探索は行いません。
- 屋根・木・サボテンも形状として調べるので、その上に配置される場合があります。地面の意味を識別する機能ではありません。指定先にNPC自身を含めず、地形とNPCを別の要素として配置します。変形する地形や、子メッシュをthree.jsだけで直接動かす用途は対象外です。
- 操作キャラの`avatar`には既存のwalkable処理があるため、groundは付けません。同じ要素に付けてもgroundを適用しません。地形に関係なく絶対的なYへ置きたいモデルにはgroundを付けません。

## 指定した地点の地面の高さを調べる（0.3.1）

```javascript
const map = document.getElementById("map");
const x = Math.random() * 20 - 10;
const z = Math.random() * 10 - 20;
const y = getGroundHeight(map, x, z, { from: avatar });

if (y !== null) {
  const controls = avatar.components.avatar.controls;
  controls.player.setAttribute("position", { x: x, y: y, z: z });
  controls.clearInput();
}
```

`getGroundHeight(ground, x, z, maxSlope = 45)`は、指定した地形要素とその子の静的なメッシュを上から調べ、X/Zにある最上面の**ワールド座標のY**を返します。HTMLのposition・rotation・scale、親子の変換、walkableのautoAlignで補正済みの現在位置を反映します。地形やアバターの位置は変更しません。

- X・Z・戻り値の単位はm。`maxSlope`は度で、既定値45、0以上90未満です。avatar側のmaxSlopeを変更した場合は、同じ値を第4引数へ渡します。
- 範囲外、未読込、メッシュなし、非表示（親・子を含む）、walkableのenabledがfalse、不正な引数、最上面が上限を超える急斜面の場合は`null`です。急斜面の下に床があっても、その床へ潜る高さは返しません。
- 高さ0も有効なので、`if (y)`ではなく`if (y !== null)`で確認します。GLB読込後に使い、autoAlignを使う場合は最初の高さ合わせが済んだゲーム中の座標を調べてください。
- `walkable`の有無にかかわらず、指定した要素の形状を調べます。通常は歩行に使うwalkable付きの地形と同じ要素を渡します。変形するスキンメッシュは対象外です。
- 屋根・水面・茂み・サボテンの意味は区別しません。solid、movement-area、アバターの半径、移動経路も判定しません。安全な着地点だけを選びたい場合は、床・坂だけの地形と、教材側で決めた範囲を使います。
- 戻り値は地面そのものの高さです。avatarのgroundOffsetを0以外にしている場合は、その値をYへ足して使います。

ランダムワープでは、演出を始める前にX・Z・Yを決めます。`y === null`なら今回は処理を始めず、次の判定で選び直します。モデルを沈める演出は、着地できる候補が見つかった後に始めます。

### 足元とつながる面に限定する（0.3.2）

```javascript
const y = getGroundHeight(map, x, z, { from: avatar });
if (y === null) return;
```

`from`へ足元を基準にする要素を渡すと、その要素が立っている面と**辺でつながる、傾斜上限内の面**だけを候補にします。Y=0などの固定値やモデル名には依存しません。1つのメッシュに地面・サボテン・建物がまとめられたGLBでも、立っている床と独立した上面なら除外します。候補地点の上に独立したサボテンや屋根がある場合は、その下へ潜らせずnullを返します。

- `{ from: avatar }`ではavatarのmaxSlopeとgroundOffsetを参照します。明示する場合は`{ from: avatar, maxSlope: 30 }`の形です。従来の第4引数に数値を渡す書き方も使えます。
- 出発点の真上に屋根があっても、足元に近い面を基準にします。足元に面が見つからない場合、fromが削除済み・別のシーンの場合はnullです。
- 共有辺の頂点座標を使うため、UVなどで頂点が分かれた継ぎ目や、同じ辺で接する別メッシュも扱います。形状・配置・表示が変わると接続を再計算します。
- これは「砂」「サボテン」といった意味を識別する機能や経路探索ではありません。坂でつながる屋根は候補になり、別パーツの階段・離れた床・途中に隙間のある面は候補から外れることがあります。そうした場所へもワープしたい教材では、着地用の面や地点を別途指定してください。
- アバターの半径や他のsolidとの重なりは判定しません。床と障害物が同じ連続した緩い形状なら、その部分まで区別できません。

ランダムワープでは`from`付きで候補を調べ、nullなら次の判定で選び直します。特定モデルに合わせた`y > 0`などの条件は不要です。

## 共有空間への接続

`vr-shared.js`はブラウザ側だけの機能です。使用する際は、対応したNode.js・Socket.IOサーバーを別途用意します。このリポジトリだけで共有サーバーは起動できません。

対応サーバーからHTMLを配信する場合の読み込み順です。`/socket.io/socket.io.js`はそのサーバーが配信します。

```html
<script src="https://aframe.io/releases/1.6.0/aframe.min.js"></script>
<script src="/socket.io/socket.io.js"></script>
<script src="https://cdn.jsdelivr.net/gh/projapayuri/aframe-vr-kit@v0.3.5/vr-kit.js"></script>
<script src="https://cdn.jsdelivr.net/gh/projapayuri/aframe-vr-kit@v0.3.5/vr-shared.js"></script>
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

ブラウザのConsoleで`VR_KIT_VERSION`を読むと`0.3.5`を確認できます。授業では`@v0.3.5`のように特定のリリースを指定したURLで読み込んでください。更新時は新しいバージョンを用意し、公開済みのタグは変更しません。

別管理のローカル開発環境で、Chromeによる操作・モデル切り替え・距離判定・設定変更・リセット・一人用取得・共有を検証しています。テストコードや画像はこのリポジトリには含めません。solidでの停止、後退、回り込み、衝突中のWalk/IdleもChromeで確認しています。20接続シミュレーションは20台実機の検証とは別です。学校LAN・複数PC・VRヘッドセットは未確認です。

このライブラリ本体の公開ライセンスは未設定です。
