# -*- coding: utf-8 -*-
"""LiveClass AI 아키텍처 → draw.io(.drawio) 생성기.
노드/엣지를 데이터로 정의하고 mxGraphModel XML로 내보낸다. 탭 하나 = 다이어그램 하나."""
from xml.sax.saxutils import escape

BUILT  = "rounded=0;whiteSpace=wrap;html=1;fillColor=#E4F2EB;strokeColor=#2C7A5B;fontColor=#0F1B2A;fontSize=13;verticalAlign=middle;"
PLAN   = "rounded=0;whiteSpace=wrap;html=1;fillColor=#EDF1F4;strokeColor=#94A3AF;fontColor=#43505C;fontSize=13;dashed=1;"
KEY    = "rounded=0;whiteSpace=wrap;html=1;fillColor=#E1EDF4;strokeColor=#1D4E6F;strokeWidth=2;fontColor=#0F1B2A;fontSize=13;"
DATA   = "shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=12;whiteSpace=wrap;html=1;fillColor=#F8EFDD;strokeColor=#A96F16;fontColor=#0F1B2A;fontSize=12;"
ACTOR  = "rounded=1;arcSize=50;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#5A6C7B;fontColor=#0F1B2A;fontSize=13;"
EXT    = "rounded=0;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#C3CFD9;fontColor=#4A5A6B;fontSize=12;dashed=1;"
ZONE   = "rounded=0;whiteSpace=wrap;html=1;fillColor=#F4F7F9;strokeColor=#C3CFD9;dashed=1;verticalAlign=top;align=left;spacingLeft=10;spacingTop=4;fontColor=#7C8B99;fontSize=11;container=0;"
NOTE   = "text;html=1;align=left;verticalAlign=top;fontSize=11;fontColor=#4A5A6B;"

E      = "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#5A6C7B;strokeWidth=1.5;fontSize=10;fontColor=#4A5A6B;endArrow=block;endFill=1;jettySize=auto;"
E_PLAN = E.replace("#5A6C7B", "#9DAAB6") + "dashed=1;"
E_HOT  = "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#D9342B;strokeWidth=2;fontSize=10;fontColor=#D9342B;endArrow=block;endFill=1;"
E_BACK = E + "dashed=1;"

def N(i, t, sub=None, x=0, y=0, w=180, h=60, s=BUILT):
    v = f"<b>{t}</b>" + (f"<br><font style='font-size:10px;color:#5A6C7B'>{sub}</font>" if sub else "")
    return dict(kind="v", id=i, value=v, x=x, y=y, w=w, h=h, style=s)

def Z(i, t, x, y, w, h):
    return dict(kind="v", id=i, value=t, x=x, y=y, w=w, h=h, style=ZONE)

def T(i, t, x, y, w=420, h=60):
    return dict(kind="v", id=i, value=t, x=x, y=y, w=w, h=h, style=NOTE)

def L(a, b, t="", s=E, ex=None, ey=None):
    d = dict(kind="e", src=a, tgt=b, value=t, style=s)
    if ex is not None:
        d["style"] += f"exitX={ex[0]};exitY={ex[1]};exitDx=0;exitDy=0;"
    if ey is not None:
        d["style"] += f"entryX={ey[0]};entryY={ey[1]};entryDx=0;entryDy=0;"
    return d

def render(diagrams, path):
    out = ['<mxfile host="app.diagrams.net" type="device">']
    for di, (name, cells) in enumerate(diagrams):
        out.append(f'  <diagram id="dg{di}" name="{escape(name)}">')
        out.append('    <mxGraphModel dx="1400" dy="900" grid="1" gridSize="10" guides="1" '
                   'tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" '
                   'pageWidth="1169" pageHeight="826" math="0" shadow="0">')
        out.append('      <root><mxCell id="0"/><mxCell id="1" parent="0"/>')
        n = 0
        for c in cells:
            n += 1
            if c["kind"] == "v":
                out.append(
                    f'        <mxCell id="{c["id"]}" value="{escape(c["value"])}" '
                    f'style="{c["style"]}" vertex="1" parent="1">'
                    f'<mxGeometry x="{c["x"]}" y="{c["y"]}" width="{c["w"]}" height="{c["h"]}" as="geometry"/>'
                    f'</mxCell>')
            else:
                out.append(
                    f'        <mxCell id="e{di}_{n}" value="{escape(c["value"])}" '
                    f'style="{c["style"]}" edge="1" parent="1" '
                    f'source="{c["src"]}" target="{c["tgt"]}">'
                    f'<mxGeometry relative="1" as="geometry"/></mxCell>')
        out.append('      </root></mxGraphModel>')
        out.append('    </diagram>')
    out.append('</mxfile>')
    open(path, "w", encoding="utf-8").write("\n".join(out))
    return len(diagrams)
