// js/ui/effects.js
// Pure visual effects, no dependency on state or other modules.

export function launchConfetti() {
  const colors = ['#1E4A3C','#2E6B56','#C0392B','#F39C12','#3498DB','#9B59B6','#1ABC9C'];
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden;';
  document.body.appendChild(container);

  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('div');
    const color = colors[Math.floor(Math.random() * colors.length)];
    const size = Math.random() * 8 + 5;
    const left = Math.random() * 100;
    const delay = Math.random() * 0.6;
    const duration = Math.random() * 1.5 + 1.5;
    const rotation = Math.random() * 360;
    const shape = Math.random() > 0.5 ? '50%' : '0';

    piece.style.cssText = `
      position:absolute;
      width:${size}px;height:${size}px;
      background:${color};
      border-radius:${shape};
      left:${left}%;top:-10px;
      opacity:1;
      animation:confettiFall ${duration}s ${delay}s ease-in forwards;
      transform:rotate(${rotation}deg);
    `;
    container.appendChild(piece);
  }

  setTimeout(() => container.remove(), 3500);
}
