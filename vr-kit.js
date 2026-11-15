/* vr-kit 0.2.0：ローカル開発版。A-Frameの後に読み込む。 */
if (typeof AFRAME === 'undefined') {
  throw new Error('[vr-kit] A-Frameが見つかりません。aframe.min.jsをvr-kit.jsより先に読み込んでください。');
}
const VR_KIT_VERSION = '0.2.0';

/* 2つのA-Frame要素の位置が、指定距離以内ならtrueを返す（単位：m）。 */
function isNear(first, second, distance = 2) {
  if (!first?.isConnected || !second?.isConnected ||
      !first.object3D?.isObject3D || !second.object3D?.isObject3D ||
      !first.sceneEl || first.sceneEl !== second.sceneEl ||
      !Number.isFinite(distance) || distance < 0) return false;

  // 親の位置・回転・拡大率と、ライブラリによるアバターの親変更も反映する。
  const firstPosition = first.object3D.getWorldPosition(new THREE.Vector3());
  const secondPosition = second.object3D.getWorldPosition(new THREE.Vector3());
  const actualDistance = firstPosition.distanceTo(secondPosition);
  return Number.isFinite(actualDistance) && actualDistance <= distance;
}

/* 開始位置・向きへ戻す。取得数やアイテムの状態は学生のコードで戻す。 */
function resetAvatar(element) {
  const controls = element?.components?.avatar?.controls;
  if (!controls) {
    console.warn('[vr-kit] resetAvatarには、avatarの準備が完了した要素を渡してください。');
    return false;
  }
  controls.reset();
  return true;
}

/* GLBのアニメーション名を、設定前でもConsoleで確認できるようにする。 */
(function reportGLBAnimations() {
  const reported = new WeakMap();
  function showAnimations(element) {
    // 通信で増える相手のモデルは除き、自分で配置したモデルを表示する。
    if (!element.hasAttribute('gltf-model') || element.closest('.remote-avatar')) return;
    const model = element.getObject3D('mesh');
    if (!model || reported.get(element) === model) return;
    reported.set(element, model);
    let source = element.getAttribute('gltf-model');
    if (source.startsWith('#')) source = document.getElementById(source.slice(1))?.getAttribute('src') || source;
    const clips = model.animations || [];
    console.group('[GLB] ' + source + ' — アニメーション一覧');
    if (clips.length) {
      console.table(clips.map(function animationName(clip) { return { 名前: clip.name }; }));
      console.log('walk / idle に、この名前を指定できます。');
    } else {
      console.log('アニメーションはありません。');
    }
    console.groupEnd();
  }
  function modelLoaded(event) { showAnimations(event.target); }
  function modelFailed(event) {
    const element = event.target;
    if (!element.hasAttribute('gltf-model') || element.closest('.remote-avatar')) return;
    console.warn('[GLB] ' + element.getAttribute('gltf-model') + ' を読み込めません。ファイルの場所・名前（大文字／小文字）を確認してください。Live ServerまたはNode.jsサーバーからHTMLを開いてください。');
  }
  document.addEventListener('model-loaded', modelLoaded);
  document.addEventListener('model-error', modelFailed);
  document.querySelectorAll('[gltf-model]').forEach(showAnimations);
})();

/* 配布済みライブラリ：入退室と同期。学生の通信とは vr: イベントで分ける。 */
function vrKit(options) {
  const scene = document.querySelector(options.scene);
  const camera = document.querySelector(options.camera);
  if (!scene || !camera) throw new Error('scene/camera が見つかりません');
  const player = options.player ? document.querySelector(options.player) : camera;
  const localAvatar = options.localAvatar ? document.querySelector(options.localAvatar) : null;
  if (!player) throw new Error('player が見つかりません');
  const roomName = options.room ?? 'main';
  if (typeof roomName !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(roomName)) throw new Error('部屋名は半角英数字・_・-の1〜40文字です');
  const models = options.models || { red: '/models/red.glb', blue: '/models/blue.glb', green: '/models/green.glb' };
  function hasModel(name) {
    return typeof name === 'string' && Object.hasOwn(models, name);
  }
  let selected = options.avatar || Object.keys(models)[0];
  if (!hasModel(selected)) throw new Error('未登録のアバター');
  const socket = options.socket || io({ autoConnect: false });
  const listeners = new Map();
  const others = new Map();
  let count = 0;
  let destroyed = false;
  let joined = false;
  let beginTimer;
  const worldPosition = new THREE.Vector3();
  const worldRotation = new THREE.Quaternion();
  const angles = new THREE.Euler(0, 0, 0, 'YXZ');

  function emit(name, value) {
    (listeners.get(name) || []).forEach(function notify(fn) { fn(value); });
  }
  function clear() {
    others.forEach(function removeAvatar(el) { el.remove(); });
    others.clear();
  }
  function applyPose(el, pose) {
    el.setAttribute('position', { x: pose.x, y: pose.y, z: pose.z });
    el.setAttribute('rotation', { x: 0, y: pose.yaw, z: 0 });
  }
  function createModel(root, name) {
    const entry = models[name];
    const config = typeof entry === 'string' ? { src: entry } : entry;
    if (!config || typeof config.src !== 'string') throw new Error('モデルの src を指定してください：' + name);
    const model = document.createElement('a-entity');
    model.classList.add('avatar-model');
    model.setAttribute('position', config.position || '0 0 0');
    model.setAttribute('scale', config.scale || options.avatarScale || '1 1 1');
    model.setAttribute('rotation', { x: 0, y: config.yawOffset ?? options.avatarDirectionOffset ?? 0, z: 0 });
    model.addEventListener('model-error', function reportModelError() {
      if (!destroyed && root.isConnected && root.firstElementChild === model) {
        emit('model-error', { id: root.dataset.playerId, avatar: name, src: config.src });
      }
    });
    const walk = config.walk ?? options.walk ?? '';
    const idle = config.idle ?? options.idle ?? '';
    if (walk || idle) {
      const target = root === localAvatar ? player : root;
      model.setAttribute('avatar-motion', { target: '#' + CSS.escape(target.id), walk: walk, idle: idle });
    }
    // 遅れて完了した旧モデルのロードで、新しい選択を上書きしない。
    if (root.firstElementChild) root.firstElementChild.remove();
    root.appendChild(model);
    model.setAttribute('gltf-model', config.src);
  }
  function render(players) {
    if (destroyed) return;
    joined = players.some(function isSelf(player) { return player.id === socket.id; });
    const ids = new Set(players.map(function playerId(player) { return player.id; }));
    others.forEach(function removeMissing(el, id) {
      if (!ids.has(id)) { el.remove(); others.delete(id); emit('player-left', { id: id }); }
    });
    players.forEach(function renderPlayer(player) {
      if (player.id === socket.id) return; // 自分のモデルで視界をふさがない
      let root = others.get(player.id);
      const isNew = !root;
      if (!root) {
        root = document.createElement('a-entity');
        root.id = 'vr-remote-' + socket.id + '-' + player.id;
        root.classList.add('remote-avatar');
        root.dataset.playerId = player.id;
        scene.appendChild(root);
        others.set(player.id, root);
        if (AFRAME.components['vr-avatar-smooth']) root.setAttribute('vr-avatar-smooth', '');
      }
      if (root.dataset.avatar !== player.avatar) {
        const name = hasModel(player.avatar) ? player.avatar : selected;
        createModel(root, name);
        root.dataset.avatar = player.avatar;
      }
      applyPose(root, player);
      if (isNew) emit('player-joined', player);
    });
    count = players.length;
    emit('count', count);
  }
  function currentPose() {
    if (options.getPose) return options.getPose();
    player.object3D.updateWorldMatrix(true, false);
    player.object3D.getWorldPosition(worldPosition);
    player.object3D.getWorldQuaternion(worldRotation);
    angles.setFromQuaternion(worldRotation, 'YXZ');
    return {
      x: worldPosition.x,
      y: worldPosition.y - (options.eyeHeight ?? 1.6),
      z: worldPosition.z,
      yaw: THREE.MathUtils.radToDeg(angles.y)
    };
  }
  function join() {
    if (localAvatar) localAvatar.dataset.playerId = socket.id;
    if (!destroyed) socket.emit('vr:join', { room: roomName, avatar: selected, pose: currentPose() });
  }
  function receivePose(pose) {
    const el = others.get(pose.id);
    if (el) { applyPose(el, pose); emit('player-moved', pose); }
  }
  function disconnected() {
    if (localAvatar) delete localAvatar.dataset.playerId;
    joined = false;
    clear();
    count = 0;
    emit('count', 0);
  }
  function sendPose() {
    if (destroyed || !socket.connected || !joined || !scene.hasLoaded) return;
    // 古い位置を再接続後にまとめて再送しない。
    socket.volatile.emit('vr:pose', currentPose());
  }
  function begin() { if (!destroyed) socket.connect(); }
  function pageHidden() { socket.disconnect(); }
  function pageShown(event) {
    // 戻る操作でページが復元された場合も再参加する。
    if (event.persisted) begin();
  }
  function on(name, fn) {
    if (destroyed) throw new Error('destroy 後のライブラリは使えません');
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(fn);
    if (name === 'count') fn(count);
  }
  function setAvatar(name) {
    if (destroyed) throw new Error('destroy 後のライブラリは使えません');
    if (!hasModel(name)) throw new Error('未登録のアバター');
    selected = name;
    if (localAvatar) {
      createModel(localAvatar, name);
      localAvatar.dataset.avatar = name;
    }
    if (socket.connected) socket.emit('vr:avatar', name);
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    scene.removeEventListener('loaded', begin);
    clearTimeout(beginTimer);
    clearInterval(timer);
    window.removeEventListener('pagehide', pageHidden);
    window.removeEventListener('pageshow', pageShown);
    socket.off('disconnect', disconnected);
    socket.disconnect();
    disconnected();
    socket.off('connect', join);
    socket.off('vr:state', render);
    socket.off('vr:pose', receivePose);
    listeners.clear();
    if (localAvatar) localAvatar.replaceChildren();
  }
  socket.on('connect', join);
  socket.on('vr:state', render);
  socket.on('vr:pose', receivePose);
  socket.on('disconnect', disconnected);
  window.addEventListener('pagehide', pageHidden);
  window.addEventListener('pageshow', pageShown);
  const timer = setInterval(sendPose, 100);
  if (localAvatar) {
    createModel(localAvatar, selected);
    localAvatar.dataset.avatar = selected;
  }
  if (scene.hasLoaded) beginTimer = setTimeout(begin, 0);
  else scene.addEventListener('loaded', begin, { once: true });
  return { socket: socket, on: on, setAvatar: setAvatar, destroy: destroy };
}

/* 移動中・停止中のクリップを再生する。追加の配信ライブラリは不要。 */
AFRAME.registerComponent('avatar-motion', {
  schema: {
    target: { type: 'selector' },
    walk: { type: 'string', default: '' },
    idle: { type: 'string', default: '' }
  },
  init: function init() {
    this.previous = new THREE.Vector3();
    this.position = new THREE.Vector3();
    this.lastMoved = -Infinity;
    this.lastState = null;
    this.actions = {};
    this.readPosition();
    this.previous.copy(this.position);
    this.modelLoaded = this.modelLoaded.bind(this);
    this.el.addEventListener('model-loaded', this.modelLoaded);
    if (this.el.getObject3D('mesh')) this.modelLoaded();
  },
  readPosition: function readPosition() {
    const target = this.data.target;
    if (!target) return;
    target.object3D.updateWorldMatrix(true, false);
    target.object3D.getWorldPosition(this.position);
  },
  update: function update(previous) {
    if (!this.mesh || (previous.walk === undefined && previous.idle === undefined)) return;
    if (previous.walk !== this.data.walk || previous.idle !== this.data.idle) this.configure();
  },
  modelLoaded: function modelLoaded() {
    this.release();
    this.mesh = this.el.getObject3D('mesh');
    this.readPosition();
    this.previous.copy(this.position);
    this.lastMoved = -Infinity;
    this.lastState = 'idle';
    this.configure();
  },
  configure: function configure() {
    clearTimeout(this.warningTimer);
    const state = this.lastState || 'idle';
    this.release();
    const clips = this.mesh.animations || [];
    const data = this.data;
    function findClip(name) {
      if (!name) return null;
      const exact = clips.find(function exactName(clip) { return clip.name === name; });
      if (exact) return exact;
      const matches = clips.filter(function shortName(clip) { return clip.name.split('|').pop() === name; });
      return matches.length === 1 ? matches[0] : null;
    }
    const walk = findClip(data.walk), idle = findClip(data.idle);
    const missing = [data.walk && !walk ? data.walk : '', data.idle && !idle ? data.idle : ''].filter(Boolean);
    if (missing.length && !this.el.closest('.remote-avatar')) {
      const key = JSON.stringify([this.mesh.uuid, data.walk, data.idle]);
      // 切り替えと同時に変更した旧モデルの設定は案内しない。
      this.warningTimer = setTimeout(function warnMissingClip() {
        if (this.el.getObject3D('mesh') !== this.mesh || this.lastClipWarning === key) return;
        this.lastClipWarning = key;
        console.warn('[vr-kit] ' + this.el.getAttribute('gltf-model') + ' のアニメーション「' + missing.join('」「') + '」を特定できません。Consoleの一覧にある完全な名前をwalk / idleへ指定してください。');
      }.bind(this), 0);
    } else this.lastClipWarning = '';
    if (walk || idle) {
      this.mixer = new THREE.AnimationMixer(this.mesh);
      if (walk) this.actions.walk = this.mixer.clipAction(walk);
      if (idle) this.actions.idle = this.mixer.clipAction(idle);
    }
    this.lastState = null;
    this.playState(state);
    this.el.emit('vr-animation-info', {
      clips: clips.map(function clipName(clip) { return clip.name; }),
      walk: walk ? walk.name : '',
      idle: idle ? idle.name : '',
      requestedWalk: data.walk,
      requestedIdle: data.idle,
      missing: missing
    }, true);
  },
  playState: function playState(state) {
    if (state === this.lastState) return;
    this.lastState = state;
    if (this.mixer) this.mixer.stopAllAction();
    const action = this.actions[state];
    if (action) action.reset().play();
    this.el.dataset.motion = action ? state : 'none';
    this.el.dataset.animationClip = action ? action.getClip().name : '';
  },
  tick: function tick(time, delta) {
    if (!delta || !this.data.target) return;
    this.readPosition();
    const seconds = Math.min(delta / 1000, 0.25);
    const moving = this.position.distanceTo(this.previous) / seconds > 0.05;
    this.previous.copy(this.position);
    const controls = this.data.target.components['wasd-controls'];
    if (controls) {
      // 本人はキーを離したら、慣性が残っていてもRunを途中で止める。
      const keys = controls.keys;
      const input = controls.data.enabled && (
        (controls.data.adEnabled && (keys.KeyA || keys.KeyD || keys.ArrowLeft || keys.ArrowRight)) ||
        (controls.data.wsEnabled && (keys.KeyW || keys.KeyS || keys.ArrowUp || keys.ArrowDown))
      );
      this.playState(moving && input ? 'walk' : 'idle');
    } else {
      if (moving) this.lastMoved = time;
      // 相手の位置は100ms間隔で届くため、歩行と停止の細かい往復を防ぐ。
      this.playState(time - this.lastMoved < 180 ? 'walk' : 'idle');
    }
    if (this.mixer) this.mixer.update(seconds);
  },
  release: function release() {
    if (this.mixer) { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.mesh); }
    this.mixer = null;
    this.actions = {};
  },
  remove: function remove() {
    clearTimeout(this.warningTimer);
    this.el.removeEventListener('model-loaded', this.modelLoaded);
    this.release();
  }
});

/* 本人の操作だけ、入力を離した方向の慣性を止める。 */
AFRAME.registerComponent('vr-stop-controls', {
  dependencies: ['wasd-controls'],
  before: ['wasd-controls'],
  schema: { turnSpeed: { type: 'number', default: 0 } },
  tick: function tick(time, delta) {
    const controls = this.el.components['wasd-controls'];
    const data = controls.data, keys = controls.keys;
    const left = !!(keys.KeyA || keys.ArrowLeft);
    const right = !!(keys.KeyD || keys.ArrowRight);
    const forward = !!(keys.KeyW || keys.ArrowUp);
    const backward = !!(keys.KeyS || keys.ArrowDown);
    if (data.enabled && this.data.turnSpeed && delta) {
      const rotation = this.el.getAttribute('rotation');
      const turn = (Number(left) - Number(right)) * this.data.turnSpeed * Math.min(delta / 1000, 0.1);
      if (turn) this.el.setAttribute('rotation', { x: 0, y: rotation.y + turn, z: 0 });
    }
    // 移動を計算する前に速度を0にする。反対方向の同時押しも停止する。
    if (!data.enabled || !data.adEnabled || left === right) controls.velocity[data.adAxis] = 0;
    if (!data.enabled || !data.wsEnabled || forward === backward) controls.velocity[data.wsAxis] = 0;
  }
});

/* 自動運転版：HTMLの属性から接続・表示・選択まで準備する。 */
(function registerAutomaticVR() {
  let nextId = 0;

  // 足元を動かす共通の操作。カメラだけを一人称・三人称で切り替える。
  function setupThirdPerson(scene, camera, data, uniqueId, existingAvatar = null) {
    const original = {
      parent: camera.parentNode, threeParent: camera.object3D.parent,
      position: { ...camera.getAttribute('position') }, rotation: { ...camera.getAttribute('rotation') },
      camera: { ...camera.getDOMAttribute('camera') },
      look: { ...camera.getAttribute('look-controls') }, wasd: { ...camera.getAttribute('wasd-controls') }
    };
    const position = new THREE.Vector3(), orientation = new THREE.Quaternion();
    const source = existingAvatar || camera;
    source.object3D.updateWorldMatrix(true, false);
    source.object3D.getWorldPosition(position);
    source.object3D.getWorldQuaternion(orientation);
    const originalAvatar = existingAvatar ? {
      parent: existingAvatar.object3D.parent,
      position: { ...existingAvatar.getAttribute('position') },
      rotation: { ...existingAvatar.getAttribute('rotation') },
      scale: { ...existingAvatar.getAttribute('scale') },
      hadLocalClass: existingAvatar.classList.contains('local-avatar')
    } : null;
    const facing = new THREE.Euler(0, 0, 0, 'YXZ').setFromQuaternion(orientation, 'YXZ');
    const player = document.createElement('a-entity');
    player.id = 'vr-player-' + uniqueId;
    player.className = 'vr-player';
    const startPosition = { x: position.x, y: existingAvatar ? position.y : position.y - 1.6, z: position.z };
    const startRotation = { x: 0, y: THREE.MathUtils.radToDeg(facing.y), z: 0 };
    player.setAttribute('position', { ...startPosition });
    player.setAttribute('rotation', { ...startRotation });
    // 子要素の初期化前にも、初期位置と向きを3D側へ反映する。
    player.object3D.position.set(startPosition.x, startPosition.y, startPosition.z);
    player.object3D.rotation.set(0, facing.y, 0);
    player.setAttribute('wasd-controls', { acceleration: 30 });
    player.setAttribute('vr-stop-controls', '');
    const local = existingAvatar || document.createElement('a-entity');
    if (!existingAvatar) {
      local.id = 'vr-local-avatar-' + uniqueId;
      player.appendChild(local);
    }
    local.classList.add('local-avatar');
    scene.appendChild(player);
    let controlsEnabled = data.enabled ?? true;
    let faceDirection = data.faceMovement ?? false;
    let turnSpeed = 120;
    if (existingAvatar) {
      player.object3D.attach(local.object3D);
      local.setAttribute('position', { x: 0, y: 0, z: 0 });
    }
    const baseAvatarRotation = local.object3D.quaternion.clone();
    const vertical = new THREE.Vector3(0, 1, 0);
    const headingRotation = new THREE.Quaternion();
    const modelRotation = new THREE.Quaternion();
    const posePosition = new THREE.Vector3();
    const poseRotation = new THREE.Quaternion();
    const poseAngles = new THREE.Euler(0, 0, 0, 'YXZ');
    let heading = 0;
    let avatarDirection = 0;
    function applyFacing() {
      headingRotation.setFromAxisAngle(vertical, heading);
      modelRotation.setFromAxisAngle(vertical, THREE.MathUtils.degToRad(avatarDirection));
      local.object3D.quaternion.copy(headingRotation).multiply(baseAvatarRotation).multiply(modelRotation);
      const rotation = new THREE.Euler(0, 0, 0, local.object3D.rotation.order).setFromQuaternion(local.object3D.quaternion, local.object3D.rotation.order);
      local.setAttribute('rotation', { x: THREE.MathUtils.radToDeg(rotation.x), y: THREE.MathUtils.radToDeg(rotation.y), z: THREE.MathUtils.radToDeg(rotation.z) });
    }
    function setAvatarDirection(degrees) {
      if (!Number.isFinite(degrees)) {
        console.warn('[vr-kit] avatarDirectionは角度を数値で指定してください。');
        return;
      }
      avatarDirection = degrees;
      applyFacing();
    }
    // カメラの向きやモデル固有の補正を含めず、本人の足元と進行方向を返す。
    function getPose() {
      player.object3D.updateWorldMatrix(true, false);
      player.object3D.getWorldPosition(posePosition);
      player.object3D.getWorldQuaternion(poseRotation);
      headingRotation.setFromAxisAngle(vertical, heading);
      poseRotation.multiply(headingRotation);
      poseAngles.setFromQuaternion(poseRotation, 'YXZ');
      return { x: posePosition.x, y: posePosition.y, z: posePosition.z, yaw: THREE.MathUtils.radToDeg(poseAngles.y) };
    }
    if (existingAvatar) setAvatarDirection(data.avatarDirection);
    camera.setAttribute('wasd-controls', 'enabled', false);
    camera.setAttribute('look-controls', 'enabled', false);
    // 三人称は近めの画角。HTMLで指定したfovがあれば優先する。
    if (original.camera.fov === undefined) camera.setAttribute('camera', 'fov', 60);
    // DOMの移動によるcameraコンポーネントの再初期化を避け、3D上の親だけを変える。
    player.object3D.add(camera.object3D);
    const offset = { ...data.cameraOffset };
    let lookHeight = data.lookHeight;
    camera.setAttribute('position', offset);
    const view = new THREE.PerspectiveCamera();
    view.position.set(offset.x, offset.y, offset.z);
    view.lookAt(0, lookHeight, 0);
    const rotation = new THREE.Euler(0, 0, 0, 'YXZ').setFromQuaternion(view.quaternion, 'YXZ');
    camera.setAttribute('rotation', {
      x: THREE.MathUtils.radToDeg(rotation.x), y: THREE.MathUtils.radToDeg(rotation.y), z: THREE.MathUtils.radToDeg(rotation.z)
    });
    const baseCameraRotation = camera.object3D.quaternion.clone();
    const cameraHeading = new THREE.Quaternion();
    const firstPersonAngles = new THREE.Euler(0, 0, 0, 'YXZ');
    const localVisible = local.object3D.visible;
    let viewMode = 'third';
    let eyeHeight = data.eyeHeight ?? 1.6;
    let pitch = 0;
    let cameraFollow = !!data.cameraFollow;
    function updateCamera() {
      if (viewMode === 'first') {
        camera.object3D.position.set(0, eyeHeight, 0);
        firstPersonAngles.set(pitch, 0, 0);
        camera.object3D.quaternion.setFromEuler(firstPersonAngles);
        return;
      }
      // 体を基準にカメラを置く。旋回は共通のplayerで行う。
      // モデル固有のavatarDirectionはカメラに含めない。
      cameraHeading.setFromAxisAngle(vertical, cameraFollow ? heading : 0);
      camera.object3D.position.set(offset.x, offset.y, offset.z).applyQuaternion(cameraHeading);
      camera.object3D.quaternion.copy(cameraHeading).multiply(baseCameraRotation);
    }
    function setCameraFollow(enabled) {
      cameraFollow = enabled;
      setKeyboardMode();
      updateCamera();
    }
    function setKeyboardMode() {
      const turnWithKeys = viewMode === 'first' || cameraFollow;
      if (turnWithKeys) {
        // 体が向いている方向をWで進むための基準にする。
        const yaw = THREE.MathUtils.radToDeg(player.object3D.rotation.y + heading);
        player.setAttribute('rotation', { x: 0, y: yaw, z: 0 });
        heading = 0;
        applyFacing();
      }
      player.setAttribute('wasd-controls', 'adEnabled', !turnWithKeys);
      player.setAttribute('vr-stop-controls', 'turnSpeed', turnWithKeys ? turnSpeed : 0);
    }
    function setTurnSpeed(speed) {
      if (!Number.isFinite(speed) || speed < 0) {
        console.warn('[vr-kit] turnSpeedは0以上の数値（度/秒）で指定してください。');
        return;
      }
      turnSpeed = speed;
      setKeyboardMode();
    }
    function setMoveSpeed(speed) {
      if (!Number.isFinite(speed) || speed < 0) {
        console.warn('[vr-kit] moveSpeedは0以上の数値で指定してください。1が標準、2で2倍です。');
        return;
      }
      player.setAttribute('wasd-controls', 'acceleration', 30 * speed);
      player.components['wasd-controls']?.velocity?.set(0, 0, 0);
    }
    function setFaceMovement(enabled) { faceDirection = enabled; }
    function setView(nextView) {
      if (nextView !== 'first' && nextView !== 'third') return;
      if (nextView === 'first' && viewMode !== 'first') {
        pitch = 0;
      }
      viewMode = nextView;
      setKeyboardMode();
      local.object3D.visible = viewMode === 'first' ? false : localVisible;
      updateCamera();
    }
    function setEyeHeight(height) {
      if (!Number.isFinite(height) || height < 0) {
        console.warn('[vr-kit] eyeHeightは0以上の高さ（m）で指定してください。');
        return;
      }
      eyeHeight = height;
      updateCamera();
    }
    function setCameraSettings(nextOffset, nextHeight) {
      if (![nextOffset.x, nextOffset.y, nextOffset.z, nextHeight].every(Number.isFinite)) {
        console.warn('[vr-kit] cameraOffsetは3つの数値、lookHeightは高さの数値で指定してください。');
        return;
      }
      Object.assign(offset, nextOffset);
      lookHeight = nextHeight;
      view.position.set(offset.x, offset.y, offset.z);
      view.lookAt(0, lookHeight, 0);
      baseCameraRotation.copy(view.quaternion);
      updateCamera();
    }
    setView(data.view);
    const previousPosition = new THREE.Vector3();
    const currentPosition = new THREE.Vector3();
    const movement = new THREE.Vector3();
    const referenceRotation = new THREE.Quaternion();
    player.object3D.updateWorldMatrix(true, false);
    player.object3D.getWorldPosition(previousPosition);
    function faceMovement(delta) {
      if (!delta) return;
      player.object3D.updateWorldMatrix(true, false);
      player.object3D.getWorldPosition(currentPosition);
      movement.subVectors(currentPosition, previousPosition);
      previousPosition.copy(currentPosition);
      // 一人称と追従する三人称はA/Dで旋回する。後退で体を反転させない。
      if (viewMode === 'first' || cameraFollow || !faceDirection) return;
      movement.y = 0;
      if (movement.length() / (delta / 1000) <= 0.05) return;
      // 移動の基準とカメラは回さず、体だけを実際の移動方向へ向ける。
      player.object3D.getWorldQuaternion(referenceRotation);
      movement.applyQuaternion(referenceRotation.invert());
      heading = Math.atan2(-movement.x, -movement.z);
      applyFacing();
      updateCamera();
    }
    const canvas = scene.canvas;
    let drag = null;
    function clearInput() {
      const wasd = player.components['wasd-controls'];
      if (wasd) { wasd.keys = {}; wasd.velocity?.set(0, 0, 0); }
      drag = null;
      const motion = local.components['avatar-motion'];
      if (motion) motion.playState('idle');
    }
    function setEnabled(enabled) {
      controlsEnabled = enabled;
      player.setAttribute('wasd-controls', 'enabled', enabled);
      clearInput();
    }
    function reset() {
      clearInput();
      player.setAttribute('position', { ...startPosition });
      player.setAttribute('rotation', { ...startRotation });
      heading = 0;
      pitch = 0;
      applyFacing();
      updateCamera();
      player.object3D.getWorldPosition(previousPosition);
    }
    function pointerDown(event) {
      if (!controlsEnabled || event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, pitch: pitch, yaw: player.getAttribute('rotation').y, id: event.pointerId };
      canvas.setPointerCapture(event.pointerId);
      canvas.focus();
    }
    function pointerMove(event) {
      if (!controlsEnabled || !drag || drag.id !== event.pointerId) return;
      const previousYaw = player.getAttribute('rotation').y;
      const nextYaw = drag.yaw - (event.clientX - drag.x) * 0.2;
      player.setAttribute('rotation', { x: 0, y: nextYaw, z: 0 });
      if (viewMode === 'first') {
        pitch = THREE.MathUtils.clamp(drag.pitch - THREE.MathUtils.degToRad((event.clientY - drag.y) * 0.2), -Math.PI * 4 / 9, Math.PI * 4 / 9);
      } else if (faceDirection && !cameraFollow) {
        // ドラッグはカメラの基準だけを回し、停止中の体の向きは保つ。
        heading -= THREE.MathUtils.degToRad(nextYaw - previousYaw);
        applyFacing();
      }
      // 追従中のドラッグは、体とカメラを一緒に回す。
      updateCamera();
    }
    function pointerUp() { drag = null; }
    canvas.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', pointerUp);
    window.addEventListener('blur', pointerUp);
    setTurnSpeed(data.turnSpeed ?? 120);
    setMoveSpeed(data.moveSpeed ?? 1);
    setEnabled(controlsEnabled);
    function destroy() {
      local.object3D.visible = localVisible;
      canvas.removeEventListener('pointerdown', pointerDown);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('pointercancel', pointerUp);
      window.removeEventListener('blur', pointerUp);
      if (original.parent.isConnected) {
        original.threeParent.add(camera.object3D);
        camera.setAttribute('position', original.position);
        camera.setAttribute('rotation', original.rotation);
        camera.setAttribute('camera', original.camera, true);
        camera.setAttribute('look-controls', original.look);
        camera.setAttribute('wasd-controls', original.wasd);
      }
      if (originalAvatar) {
        if (local.isConnected) {
          originalAvatar.parent.add(local.object3D);
          local.setAttribute('position', originalAvatar.position);
          local.setAttribute('rotation', originalAvatar.rotation);
          local.setAttribute('scale', originalAvatar.scale);
        }
        if (!originalAvatar.hadLocalClass) local.classList.remove('local-avatar');
      }
      player.remove();
    }
    return { player: player, localAvatar: local, setAvatarDirection: setAvatarDirection, setCameraFollow: setCameraFollow, setView: setView, setEyeHeight: setEyeHeight, setTurnSpeed: setTurnSpeed, setMoveSpeed: setMoveSpeed, setEnabled: setEnabled, setFaceMovement: setFaceMovement, setCameraSettings: setCameraSettings, reset: reset, faceMovement: faceMovement, getPose: getPose, destroy: destroy };
  }

  // すでに配置したGLBを、そのまま本人として操作する初回用コンポーネント。
  AFRAME.registerComponent('avatar', {
    schema: {
      view: { type: 'string', default: 'third' },
      enabled: { type: 'boolean', default: true },
      moveSpeed: { type: 'number', default: 1 },
      avatarDirection: { type: 'number', default: 0 },
      faceMovement: { type: 'boolean', default: true },
      cameraFollow: { type: 'boolean', default: false },
      turnSpeed: { type: 'number', default: 120 },
      eyeHeight: { type: 'number', default: 1.6 },
      cameraOffset: { type: 'vec3', default: { x: 0.6, y: 2, z: 3 } },
      lookHeight: { type: 'number', default: 1.1 },
      walk: { type: 'string', default: '' },
      idle: { type: 'string', default: '' }
    },
    init: function init() {
      this.removed = false;
      // 選択を素早く変えても、古いGLBの読み込み結果で上書きしない。
      this.guardModelLoading = this.guardModelLoading.bind(this);
      this.el.addEventListener('componentinitialized', this.guardModelLoading);
      this.guardModelLoading();
      this.start = this.start.bind(this);
      const scene = this.el.sceneEl;
      this.scene = scene;
      if (scene.hasLoaded) this.start();
      else scene.addEventListener('loaded', this.start, { once: true });
    },
    update: function update(previous) {
      if (!this.controls) return;
      if (this.controls && previous.view !== this.data.view) {
        if (this.data.view === 'first' || this.data.view === 'third') this.controls.setView(this.data.view);
        else console.warn('view は first または third にしてください。');
      }
      if (previous.cameraFollow !== this.data.cameraFollow) {
        this.controls.setCameraFollow(this.data.cameraFollow);
      }
      if (previous.turnSpeed !== this.data.turnSpeed) this.controls.setTurnSpeed(this.data.turnSpeed);
      if (previous.moveSpeed !== this.data.moveSpeed) this.controls.setMoveSpeed(this.data.moveSpeed);
      if (previous.enabled !== this.data.enabled) this.controls.setEnabled(this.data.enabled);
      if (previous.faceMovement !== this.data.faceMovement) this.controls.setFaceMovement(this.data.faceMovement);
      if (previous.avatarDirection !== this.data.avatarDirection) this.controls.setAvatarDirection(this.data.avatarDirection);
      const offset = this.data.cameraOffset, oldOffset = previous.cameraOffset || {};
      if (offset.x !== oldOffset.x || offset.y !== oldOffset.y || offset.z !== oldOffset.z || previous.lookHeight !== this.data.lookHeight) {
        this.controls.setCameraSettings(offset, this.data.lookHeight);
      }
      if (this.controls && previous.eyeHeight !== this.data.eyeHeight) {
        this.controls.setEyeHeight(this.data.eyeHeight);
      }
      if (previous.walk !== this.data.walk || previous.idle !== this.data.idle) this.syncMotion(true);
    },
    syncMotion: function syncMotion(updateClips = false) {
      const el = this.el;
      if (!this.controls || (!this.data.walk && !this.data.idle && !el.hasAttribute('avatar-motion'))) return;
      const target = '#' + this.controls.player.id;
      if (!el.hasAttribute('avatar-motion')) {
        this.addedMotion = true;
        el.setAttribute('avatar-motion', { target: target, walk: this.data.walk, idle: this.data.idle });
      } else {
        if (!el.components['avatar-motion']?.data.target) {
          this.boundMotionTarget = true;
          el.setAttribute('avatar-motion', 'target', target);
        }
        if (updateClips) el.setAttribute('avatar-motion', { walk: this.data.walk, idle: this.data.idle });
      }
    },
    guardModelLoading: function guardModelLoading() {
      const component = this.el.components['gltf-model'];
      if (!component || this.modelLoader === component.loader) return;
      const owner = this;
      const loader = component.loader;
      const originalLoad = loader.load;
      function current() { return !owner.removed && owner.el.components['gltf-model'] === component; }
      this.modelLoader = loader;
      this.originalModelLoad = originalLoad;
      this.guardedModelLoad = function load(source, loaded, progress, failed) {
        return originalLoad.call(this, source, function onLoaded(model) {
          if (current() && component.data === source) loaded(model);
        }, progress, function onFailed(error) {
          if (current() && component.data === source && failed) failed(error);
        });
      };
      loader.load = this.guardedModelLoad;
    },
    start: function start() {
      if (this.removed || this.controls) return;
      const el = this.el, scene = el.sceneEl;
      const camera = scene.querySelector('a-camera, [camera]');
      if (!['first', 'third'].includes(this.data.view) || !camera || scene.hasAttribute('vr-kit') || scene.vrAvatarOwner) {
        console.warn('カメラ1つと操作対象1体で使ってください。vr-kitとは併用せず、view は first または third を指定します。');
        return;
      }
      this.controls = setupThirdPerson(scene, camera, this.data, ++nextId, el);
      scene.vrAvatarOwner = this;
      this.syncMotion();
      el.emit('vr-avatar-ready', {}, false);
    },
    tick: function tick(time, delta) {
      if (this.controls) this.controls.faceMovement(delta);
    },
    remove: function remove() {
      this.removed = true;
      const scene = this.scene;
      scene.removeEventListener('loaded', this.start);
      this.el.removeEventListener('componentinitialized', this.guardModelLoading);
      if (this.modelLoader?.load === this.guardedModelLoad) this.modelLoader.load = this.originalModelLoad;
      if (this.addedMotion) this.el.removeAttribute('avatar-motion');
      else if (this.boundMotionTarget && this.el.hasAttribute('avatar-motion')) this.el.setAttribute('avatar-motion', 'target', '');
      if (this.controls) this.controls.destroy();
      if (scene.vrAvatarOwner === this) delete scene.vrAvatarOwner;
    }
  });

  AFRAME.registerComponent('vr-kit', {
    schema: {
      room: { type: 'string', default: 'main' },
      avatar: { type: 'string', default: 'red' },
      avatarDirection: { type: 'number', default: 0 },
      view: { type: 'string', default: 'first' },
      cameraOffset: { type: 'vec3', default: { x: 0.6, y: 2, z: 3 } },
      lookHeight: { type: 'number', default: 1.1 },
      walk: { type: 'string', default: '' },
      idle: { type: 'string', default: '' }
    },
    init: function init() {
      this.removed = false;
      this.start = this.start.bind(this);
      if (this.el.hasLoaded) this.start();
      else this.el.addEventListener('loaded', this.start, { once: true });
    },
    start: async function start() {
      if (this.app || this.starting || this.removed) return;
      this.starting = true;
      const scene = this.el;
      const camera = scene.querySelector('a-camera, [camera]');
      if (!camera) {
        console.warn('カメラが見つかりません。a-cameraを置いてください');
        return;
      }
      const uniqueId = ++nextId;
      if (!scene.id) scene.id = 'vr-auto-scene-' + uniqueId;
      if (!camera.id) camera.id = 'vr-auto-camera-' + uniqueId;
      let app;
      this.catalogRequest = new AbortController();
      try {
        const response = await fetch('/vr-kit/models.json', { cache: 'no-store', signal: this.catalogRequest.signal });
        if (!response.ok) throw new Error('モデル一覧を読み込めません。サーバーを確認して再読み込みしてください');
        const catalog = await response.json();
        if (this.removed) return;
        const initial = catalog.find(function findInitial(model) {
          return model.id === this.data.avatar || model.file === this.data.avatar || model.src === this.data.avatar;
        }, this);
        if (!initial) throw new Error('モデルが見つかりません：' + this.data.avatar + '（public/modelsへの配置とサーバーの再起動を確認）');
        if (!['first', 'third'].includes(this.data.view)) throw new Error('view は first または third にしてください');
        if (this.data.view === 'third') {
          this.thirdPerson = setupThirdPerson(scene, camera, this.data, uniqueId);
        }
        const models = Object.fromEntries(catalog.map(function modelURL(model) { return [model.id, model.src]; }));
        if (this.data.avatarDirection !== 0) models[initial.id] = { src: initial.src, yawOffset: this.data.avatarDirection };
        app = vrKit({
          scene: '#' + CSS.escape(scene.id),
          camera: '#' + CSS.escape(camera.id),
          room: this.data.room,
          avatar: initial.id,
          models: models,
          player: this.thirdPerson ? '#' + this.thirdPerson.player.id : undefined,
          localAvatar: this.thirdPerson ? '#' + this.thirdPerson.localAvatar.id : undefined,
          eyeHeight: this.thirdPerson ? 0 : 1.6,
          walk: this.data.walk,
          idle: this.data.idle
        });
      } catch (error) {
        if (this.removed) return;
        if (this.thirdPerson) { this.thirdPerson.destroy(); this.thirdPerson = null; }
        console.warn(error.message);
        return;
      } finally {
        this.starting = false;
      }
      this.app = app;
      this.cleanup = function cleanup() { app.destroy(); };
    },
    remove: function remove() {
      this.removed = true;
      if (this.catalogRequest) this.catalogRequest.abort();
      this.el.removeEventListener('loaded', this.start);
      if (this.cleanup) this.cleanup();
      if (this.thirdPerson) this.thirdPerson.destroy();
    }
  });
})();
