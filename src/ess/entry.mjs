import('./main.ts').catch(() => {
  document.querySelector('#app').textContent='3D 화면을 시작할 수 없습니다. 3D 다시 불러오기를 눌러 주세요.';
  parent.postMessage({channel:'dynote-ess',type:'error'},'notes://app');
});
