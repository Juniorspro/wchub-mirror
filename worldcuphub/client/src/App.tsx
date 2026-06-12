// App.tsx — shell React del WORLD CUP HUB (remake).
// Renderiza la UI (menú, entrada, HUD, paneles) y monta el juego Babylon
// en el canvas #scene. La lógica vive en src/game/main.ts (vanilla TS,
// el mismo motor del single-file) y se engancha por ids — así el juego
// y la UI pueden evolucionar por separado sin pelearse.
import { useEffect } from 'react';
import { startGame } from './game/main';

const inkTop = ['#2b1c12', '#c1272d', '#1d3a8f', '#1d7a3a', '#e8c84a', '#f4f4ee'];
const inkBottom = ['#ff7a5c', '#d96bc4', '#6bd0ff', '#7a4a2a'];
const bases = ['#e8b88f', '#c98a5e', '#8a573a', '#f2d1b3', '#9bd96b', '#6bd0ff', '#e8c84a'];

export default function App(): JSX.Element {
  useEffect(() => {
    startGame();
  }, []);

  return (
    <>
      <div id="hud">WORLD CUP HUB</div>
      <canvas id="scene" />
      <div id="hint">arrastrá para girar · pellizcá para zoom</div>
      <div id="menu">
        <div id="mttl">WORLD CUP <em>HUB</em></div>
        <div id="msub">patio mundial</div>
        <button id="mplay">JUGAR</button>
        <div id="mopts">
          <div className="mopt"><span id="llang">Idioma</span>
            <div id="langopt" className="seg"><b data-l="es" className="on">ES</b><b data-l="en">EN</b><b data-l="pt">PT</b></div>
          </div>
          <div className="mopt"><span id="lres">Resolución</span>
            <div id="resopt" className="seg"><b data-r="0.7">Baja</b><b data-r="1" className="on">Media</b><b data-r="1.6">Alta</b></div>
          </div>
          <div className="mopt"><span id="lgfx">Gráficos</span>
            <div id="gfxopt" className="seg"><b data-g="0" className="on">Clásico</b><b data-g="1">PBR</b><b data-g="2">RTX</b></div>
          </div>
          <div className="mopt"><span id="lsha">Sombras</span>
            <div id="shaopt" className="seg"><b data-s="512">Baja</b><b data-s="1024" className="on">Media</b><b data-s="2048">Alta</b></div>
          </div>
          <div className="mopt" id="paintrow" style={{ justifyContent: 'center', cursor: 'pointer' }}>
            <span id="paintbtn">🎨 pintá tu propia cara</span>
          </div>
        </div>
        <div id="mclock">🕒 …</div>
      </div>
      <div id="intro">
        <div id="ibox">
          <div id="ileft">
            <div id="tools" className="inkrow">
              {inkTop.map((c, i) => (
                <div key={c} className={i === 0 ? 'tool on' : 'tool'} data-c={c} style={{ background: c }} />
              ))}
            </div>
            <div id="ballwrap">
              <canvas id="ballcv" width={300} height={300} />
              <div id="ballrot">🔄</div>
            </div>
            <div id="tools2" className="inkrow">
              {inkBottom.map((c) => (
                <div key={c} className="tool" data-c={c} style={{ background: c }} />
              ))}
              <div className="tool" data-c="ERASE" style={{ background: '#e8b88f' }}>⌫</div>
              <div className="tool" data-c="CLEAR" style={{ background: '#3a4666', color: '#fff' }}>✕</div>
            </div>
            <div id="baserow">
              <span>bola:</span>
              {bases.map((c, i) => (
                <div key={c} className={i === 0 ? 'tool on' : 'tool'} data-b={c} style={{ background: c }} />
              ))}
            </div>
          </div>
          <div id="iright">
            <div className="ittl">⚽ WORLD CUP HUB</div>
            <div className="isub">
              pintá tu cabeza en la bola 3D<br />(girala con el 🔄) y poné tu nombre
            </div>
            <input id="iname" maxLength={14} placeholder="tu nombre…" autoComplete="off" />
            <button id="ienter" disabled>ENTRAR AL PATIO</button>
          </div>
        </div>
      </div>
      <div id="dino">
        <canvas id="dinocv" width={18} height={18} />
        <div id="dinobub">…</div>
      </div>
      <div id="joy"><div id="knob" /></div>
      <div id="coins">🪙 0</div>
      <div id="pausebtn">☰</div>
      <div id="dicebtn">🎲</div>
      <div id="pausemenu">
        <div id="pausebox">
          <div className="ittl">PAUSA</div>
          <div className="mopt"><span id="plres">Resolución</span>
            <div id="presopt" className="seg"><b data-r="0.7">Baja</b><b data-r="1" className="on">Media</b><b data-r="1.6">Alta</b></div>
          </div>
          <div className="mopt"><span id="plgfx">Gráficos</span>
            <div id="pgfxopt" className="seg"><b data-g="0" className="on">Clásico</b><b data-g="1">PBR</b><b data-g="2">RTX</b></div>
          </div>
          <div className="mopt"><span id="plsha">Sombras</span>
            <div id="pshaopt" className="seg"><b data-s="512">Baja</b><b data-s="1024" className="on">Media</b><b data-s="2048">Alta</b></div>
          </div>
          <div className="pbtn primary" id="presume">▶ Reanudar</div>
          <div className="pbtn" id="pexit">↩ Salir al menú</div>
        </div>
      </div>
      <div id="sitbtn">🪑</div>
      <div id="emobtn">😀</div>
      <div id="jumpbtn">🦘</div>
      <div id="shopbtn">🛍</div>
      <div id="chatbtn">💬</div>
      <div id="betbtn">🎲</div>
      <div id="chatbar">
        <input id="chatinput" maxLength={64} placeholder="decí algo…" />
        <button id="chatsend">➤</button>
      </div>
      <div id="emopanel" />
      <div id="shoppanel" />
      <div id="phint" />
      <div id="err" />
    </>
  );
}
