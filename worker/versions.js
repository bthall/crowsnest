// Shared by the Worker and browser. SemVer precedence ignores build metadata.
function validCollectorVersion(value) {
  return typeof value==='string' && value.length<=64 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/.test(value);
}
function compareCollectorVersions(left,right) {
  if(!validCollectorVersion(left) || !validCollectorVersion(right))return null;
  const parse=value=>{const [core,pre]=value.split('+')[0].split(/-(.*)/s);return {core:core.split('.').map(BigInt),pre:pre?.split('.')};};
  const a=parse(left),b=parse(right);
  for(let i=0;i<3;i++)if(a.core[i]!==b.core[i])return a.core[i]>b.core[i]?1:-1;
  if(!a.pre && !b.pre)return 0;
  if(!a.pre)return 1;if(!b.pre)return -1;
  for(let i=0;i<Math.max(a.pre.length,b.pre.length);i++) {
    if(a.pre[i]===undefined)return -1;if(b.pre[i]===undefined)return 1;
    const x=a.pre[i],y=b.pre[i];if(x===y)continue;
    const xn=/^\d+$/.test(x),yn=/^\d+$/.test(y);
    if(xn && yn)return BigInt(x)>BigInt(y)?1:-1;
    if(xn!==yn)return xn?-1:1;
    return x>y?1:-1;
  }
  return 0;
}
