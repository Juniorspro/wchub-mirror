#!/usr/bin/env python3
r"""Armor dist/index.html (singlefile build) against text-mutating transports.
Android download/extract chains were observed UNESCAPING backslash sequences
(\\ -> \, \xNN -> raw char), corrupting minified JS. Fix: ship bundle+CSS as
pure base64 (no backslashes exist) + a backslash-free bootstrap loader that
strips injected whitespace, length-checks, and dynamic-imports a blob module.
Usage: python3 scripts/armor.py   ->  dist/armored.html
"""
import re, base64, sys, os
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
h = open('dist/index.html', encoding='utf-8').read()
m = max(re.finditer(r'<script[^>]*type="module"[^>]*>(.*?)</script>', h, flags=re.S),
        key=lambda x: len(x.group(1)))
bundle = m.group(1)
h = h[:m.start()] + '__LOADER__' + h[m.end():]
css = ''
sm = re.search(r'<style[^>]*>(.*?)</style>', h, flags=re.S)
if sm:
    css = sm.group(1)
    h = h[:sm.start()] + h[sm.end():]
b64 = base64.b64encode(bundle.encode('utf-8')).decode()
c64 = base64.b64encode(css.encode('utf-8')).decode()
loader = ('<script type="text/plain" id="pj">' + b64 + '</script>\n'
          '<script type="text/plain" id="pc">' + c64 + '</script>\n'
          '<script>\n(function(){\n'
          "function ov(t){var d=document.getElementById('xd');if(!d){d=document.createElement('div');d.id='xd';"
          "d.style.cssText='position:fixed;left:0;top:0;right:0;z-index:99999;background:#300;color:#f99;font:12px monospace;padding:10px;white-space:pre-wrap';"
          "document.documentElement.appendChild(d)}d.textContent+=t+String.fromCharCode(10)}\n"
          "window.addEventListener('error',function(e){ov('[ERR] '+(e.message||'')+' @ '+(e.lineno||0)+':'+(e.colno||0))});\n"
          "try{var clean=new RegExp('[^A-Za-z0-9+/=]','g');"
          "var jb=document.getElementById('pj').textContent.replace(clean,'');"
          "var cb=document.getElementById('pc').textContent.replace(clean,'');"
          "if(jb.length!==" + str(len(b64)) + "){ov('[DIAG] payload JS: '+jb.length+' de " + str(len(b64)) + " chars - archivo danado en transporte');}"
          "var dec=function(b){var bin=atob(b),n=bin.length,a=new Uint8Array(n),i;for(i=0;i<n;i++)a[i]=bin.charCodeAt(i);return a};"
          "var st=document.createElement('style');st.textContent=new TextDecoder('utf-8').decode(dec(cb));document.head.appendChild(st);"
          "var blob=new Blob([dec(jb)],{type:'text/javascript'});"
          "import(URL.createObjectURL(blob)).catch(function(e){ov('[IMPORT] '+e.message)});"
          "}catch(e){ov('[LOADER] '+e.message)}\n})();\n</script>")
assert '\\' not in loader, 'loader must stay backslash-free'
h = h.replace('__LOADER__', loader)
open('dist/armored.html', 'w', encoding='utf-8').write(h)
print('dist/armored.html:', len(h) // 1024 // 1024, 'MB')
