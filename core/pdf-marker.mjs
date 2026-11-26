export const markerOpacity=0.35;

// Adjacent text spans on the same baseline share one continuous pen stroke.
export function markerLines(rects) {
  const lines=[];
  for(const {left,right,top,bottom} of rects){
    const last=lines.at(-1),height=bottom-top;
    if(last && Math.abs(last.top-top)<=height*0.1 && Math.abs(last.bottom-bottom)<=height*0.1
      && Math.max(left-last.right,last.left-right)<=height*0.35){
      last.left=Math.min(last.left,left);last.right=Math.max(last.right,right);
      last.top=Math.min(last.top,top);last.bottom=Math.max(last.bottom,bottom);
    }else lines.push({left,right,top,bottom});
  }
  return lines;
}

// Outline in PDF coordinates, with a chisel tip and slight variation along each edge.
export function markerOutline([left,bottom,right,top]) {
  const width=right-left,height=top-bottom,vertical=height>width;
  const length=Math.max(width,height),thickness=Math.min(width,height);
  const tip=Math.min(thickness*0.2,length*0.1);
  const phase=Math.sin(left*0.21+bottom*0.37);
  const rise=Math.min(length*0.065,thickness*(0.19+0.04*Math.abs(phase)))*Math.sign(phase||1);
  const point=(along,across)=>{
    const progress=along/length;
    const center=thickness/2+rise*(progress-0.5);
    const offset=center+(across-thickness/2)*0.86;
    return vertical?[left+offset,top-along]:[left+along,top-offset];
  };
  const edge=(at,depth)=>point(length*at,thickness*depth);
  return [
    point(tip,thickness*0.13),edge(0.24,0.10+phase*0.025),edge(0.54,0.14),
    edge(0.79,0.09-phase*0.025),point(length-tip*0.2,thickness*0.11),
    point(length,thickness*0.21),point(length-tip*0.7,thickness*0.89),
    edge(0.76,0.91+phase*0.025),edge(0.48,0.87),edge(0.23,0.92-phase*0.025),
    point(tip*0.2,thickness*0.9),point(0,thickness*0.82)
  ];
}
