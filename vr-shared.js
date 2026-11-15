/* 配布済み：位置・向きを滑らかに表示する。 */
AFRAME.registerComponent('vr-avatar-smooth', {
  dependencies: ['position', 'rotation'],
  schema: {
    duration: { type: 'number', default: 100 },
    snapDistance: { type: 'number', default: 5 }
  },
  init: function init() {
    this.ready = false;
    this.fromPosition = new THREE.Vector3();
    this.toPosition = new THREE.Vector3();
    this.displayPosition = new THREE.Vector3();
    this.incomingPosition = new THREE.Vector3();
    this.fromRotation = new THREE.Quaternion();
    this.toRotation = new THREE.Quaternion();
    this.displayRotation = new THREE.Quaternion();
    this.incomingRotation = new THREE.Quaternion();
    this.euler = new THREE.Euler();
  },
  sample: function sample(time) {
    const fraction = this.data.duration <= 0 ? 1 : THREE.MathUtils.clamp((time - this.startedAt) / this.data.duration, 0, 1);
    this.displayPosition.lerpVectors(this.fromPosition, this.toPosition, fraction);
    // 359度から1度への変更なども、短い方向へ回す。
    this.displayRotation.slerpQuaternions(this.fromRotation, this.toRotation, fraction);
  },
  tick: function tick(time) {
    // setAttributeで指定した値が目標。object3Dには途中の描画位置だけを置く。
    const position = this.el.components.position.data;
    const rotation = this.el.components.rotation.data;
    this.incomingPosition.set(position.x, position.y, position.z);
    this.incomingRotation.setFromEuler(this.euler.set(
      THREE.MathUtils.degToRad(rotation.x), THREE.MathUtils.degToRad(rotation.y), THREE.MathUtils.degToRad(rotation.z),
      this.el.object3D.rotation.order
    ));
    const snap = !this.ready || this.data.duration <= 0 ||
      this.displayPosition.distanceToSquared(this.incomingPosition) > this.data.snapDistance * this.data.snapDistance;
    if (snap) {
      // 最初の表示と大きなワープは、その位置から表示する。
      this.fromPosition.copy(this.incomingPosition);
      this.toPosition.copy(this.incomingPosition);
      this.fromRotation.copy(this.incomingRotation);
      this.toRotation.copy(this.incomingRotation);
      this.startedAt = time;
      this.ready = true;
    } else if (!this.incomingPosition.equals(this.toPosition) || 1 - Math.abs(this.incomingRotation.dot(this.toRotation)) > 1e-10) {
      this.sample(time);
      this.fromPosition.copy(this.displayPosition);
      this.toPosition.copy(this.incomingPosition);
      this.fromRotation.copy(this.displayRotation);
      this.toRotation.copy(this.incomingRotation);
      this.startedAt = time;
    }
    this.sample(time);
    this.el.object3D.position.copy(this.displayPosition);
    this.el.object3D.quaternion.copy(this.displayRotation);
  },
  remove: function remove() {
    // 補間を外した場合は、最新の目標へ戻す。
    const position = this.el.components.position?.data;
    const rotation = this.el.components.rotation?.data;
    if (position) this.el.object3D.position.set(position.x, position.y, position.z);
    if (rotation) this.el.object3D.rotation.set(
      THREE.MathUtils.degToRad(rotation.x), THREE.MathUtils.degToRad(rotation.y), THREE.MathUtils.degToRad(rotation.z)
    );
  }
});

/* 配布済み：27回目のアバターを共有空間へ接続する。
   学生には1人分の参加・退室・座標イベントだけを渡す。 */
function vrConnect(avatar, options = {}) {
  const nativeSocket = io({ autoConnect: false });
  const localEvents = new Set(['player-joined', 'player-left', 'player-moved', 'count', 'model-error', 'items-ready', 'item-taken', 'score']);
  const listeners = new Map();
  const lastNotification = new Map();
  let app = null, destroyed = false, count = 0;
  let readyListener, controls;
  let itemsReady = false, itemSnapshot = null, score = 0;
  const itemStates = new Map();
  const pendingItems = new Map();
  const scene = avatar.closest('a-scene');
  const socket = {
    get id() { return nativeSocket.id; },
    get connected() { return nativeSocket.connected; },
    get io() { return nativeSocket.io; },
    on: on, off: off, emit: emit, disconnect: disconnect, connect: connect, destroy: destroy
  };

  function notify(name, data) {
    for (const listener of listeners.get(name) || []) listener(data);
  }
  function on(name, listener) {
    if (localEvents.has(name)) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
      if (name === 'count') listener(count);
      if (name === 'score') listener(score);
      if (name === 'items-ready' && itemsReady) listener(itemSnapshot);
    } else nativeSocket.on(name, listener);
    return socket;
  }
  function off(name, listener) {
    if (localEvents.has(name)) listeners.get(name)?.delete(listener);
    else nativeSocket.off(name, listener);
    return socket;
  }
  function emit(name, data) {
    if (name === 'take-item') requestItem(data);
    else nativeSocket.emit(name, data);
    return socket;
  }
  function requestItem(id) {
    const item = itemStates.get(id);
    if (destroyed || !nativeSocket.connected || !itemsReady || !controls || !item || item.takenBy || pendingItems.has(id)) return;
    const request = {};
    pendingItems.set(id, request);
    // 最新の本人の位置を添付し、サーバーで取得距離も確認する。
    nativeSocket.timeout(3000).emit('vr:take-item', { id: id, pose: controls.getPose() }, function acknowledged() {
      if (pendingItems.get(id) === request) pendingItems.delete(id);
    });
  }
  function updateItem(item) {
    const element = scene.querySelector('#' + CSS.escape(item.id));
    if (!element?.object3D) return;
    // サーバーの座標を正とする。親要素がある場合はローカル座標へ変換する。
    const position = new THREE.Vector3(item.x, item.y, item.z);
    const parent = element.object3D.parent;
    if (parent) { parent.updateWorldMatrix(true, false); parent.worldToLocal(position); }
    element.setAttribute('position', { x: position.x, y: position.y, z: position.z });
    element.setAttribute('visible', !item.takenBy);
  }
  function receiveItems(snapshot) {
    pendingItems.clear(); itemStates.clear();
    itemSnapshot = snapshot;
    for (const item of snapshot.items) { itemStates.set(item.id, item); updateItem(item); }
    score = snapshot.count;
    itemsReady = true;
    notify('score', score);
    notify('items-ready', snapshot);
  }
  function itemTaken(result) {
    if (!itemsReady || result.room !== itemSnapshot.room) return;
    const item = itemStates.get(result.id);
    if (!item || item.takenBy) return;
    item.takenBy = result.playerId;
    pendingItems.delete(result.id);
    updateItem(item);
    if (result.playerId === nativeSocket.id) {
      score = result.count;
      itemSnapshot.count = score;
      notify('score', score);
    }
    notify('item-taken', result);
  }
  function disconnect() { nativeSocket.disconnect(); return socket; }
  function connect() { if (app) nativeSocket.connect(); return socket; }
  function moved(player) {
    const now = performance.now();
    // 3Dの同期は100msのまま。授業のConsole/HUD通知だけ500ms間隔にする。
    if (lastNotification.has(player.id) && now - lastNotification.get(player.id) < 500) return;
    lastNotification.set(player.id, now);
    notify('player-moved', player);
  }
  function joined(player) { notify('player-joined', player); moved(player); }
  function left(player) { lastNotification.delete(player.id); notify('player-left', player); }
  function counted(number) { count = number; notify('count', number); }
  function modelError(data) { console.error('モデルを読み込めません：' + data.src); notify('model-error', data); }
  function disconnected() {
    lastNotification.clear(); pendingItems.clear();
    itemsReady = false;
    score = 0;
    notify('score', score);
  }
  function waitForAvatar() {
    return new Promise(function wait(resolve) {
      readyListener = function ready() { resolve(avatar.components['avatar'].controls); };
      if (avatar.components['avatar']?.controls) readyListener();
      else avatar.addEventListener('vr-avatar-ready', readyListener, { once: true });
    });
  }
  async function readCatalog() {
    const response = await fetch('/vr-kit/models.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Node.jsサーバーから開いてください');
    return response.json();
  }
  async function prepare() {
    try {
      const [avatarControls, catalog] = await Promise.all([waitForAvatar(), readCatalog()]);
      controls = avatarControls;
      if (destroyed) return;
      let source = avatar.getAttribute('gltf-model');
      if (source.startsWith('#')) source = document.querySelector(source)?.getAttribute('src');
      const url = new URL(source, location.href).href;
      const model = catalog.find(function sameModel(item) { return new URL(item.src, location.href).href === url; });
      if (!model) throw new Error('GLBをpublic/modelsへ置き、サーバーを再起動してください');
      const settings = avatar.components['avatar'].data;
      const models = {};
      models[model.id] = {
        src: model.src, scale: avatar.getAttribute('scale'), yawOffset: settings.avatarDirection,
        walk: settings.walk, idle: settings.idle
      };
      if (!scene.id) scene.id = 'shared-scene-' + controls.player.id;
      app = vrKit({
        socket: nativeSocket, scene: '#' + CSS.escape(scene.id), player: '#' + CSS.escape(controls.player.id),
        camera: 'a-camera, [camera]', room: options.room || 'main', avatar: model.id, models: models,
        getPose: controls.getPose
      });
      app.on('player-joined', joined); app.on('player-left', left); app.on('player-moved', moved);
      app.on('count', counted); app.on('model-error', modelError);
    } catch (error) {
      if (!destroyed) console.error('共有空間の準備に失敗しました：' + error.message);
    }
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    avatar.removeEventListener('vr-avatar-ready', readyListener);
    if (app) app.destroy(); else nativeSocket.disconnect();
    nativeSocket.off('disconnect', disconnected);
    nativeSocket.off('vr:items', receiveItems);
    nativeSocket.off('vr:item-taken', itemTaken);
    listeners.clear(); lastNotification.clear(); itemStates.clear(); pendingItems.clear();
  }
  nativeSocket.on('disconnect', disconnected);
  nativeSocket.on('vr:items', receiveItems);
  nativeSocket.on('vr:item-taken', itemTaken);
  prepare();
  return socket;
}

