/* Optional React Native renderer. Importing the core never loads React Native. */
const React=require('react');
const {View,Text,Pressable,Image}=require('react-native');
const model=require('./index.js');
const h=React.createElement;
const defaults=Object.freeze({surface:'#fff',ink:'#17243a',muted:'#647084',line:'#dce3ed',tint:'#f3f6fb',accent:'#2458dc',accentInk:'#fff'});
function ConnectionMethods({supported,wifiAvailable,translate,onSelect,renderIcon,theme}) {
  if(typeof onSelect!=='function'||typeof renderIcon!=='function')throw new TypeError('onSelect and renderIcon are required');
  const c={...defaults,...theme};
  const methods=model.methods({supported,wifiAvailable,translate});
  return h(View,null,...methods.map((method,index)=>h(Pressable,{
    key:method.id,accessibilityRole:'button',accessibilityLabel:method.label,accessibilityHint:method.description,onPress:()=>onSelect(method.id),
    style:({pressed})=>({flexDirection:'row',alignItems:'center',gap:12,minHeight:68,paddingVertical:12,paddingHorizontal:4,borderBottomWidth:index===methods.length-1?0:1,borderBottomColor:c.line,backgroundColor:pressed?c.tint:c.surface})
  },h(View,{accessible:false,importantForAccessibility:'no-hide-descendants',style:{width:38,height:38,borderRadius:11,backgroundColor:method.icon==='posnic'?'#fff':c.tint,alignItems:'center',justifyContent:'center'}},renderIcon(method.icon,c.accent,method.icon==='posnic'?32:24)),
  h(View,{style:{flex:1}},h(Text,{style:{fontSize:14,fontWeight:'600',color:c.ink}},method.label),method.description?h(Text,{style:{fontSize:12,lineHeight:18,color:c.muted,marginTop:3}},method.description):null),
  h(View,{accessible:false,importantForAccessibility:'no-hide-descendants'},renderIcon('arrow',c.muted,16)))));
}
function ConnectionWelcome({name,subtitle,steps,copy,translate,logo,onContinue,theme}) {
  if(typeof onContinue!=='function')throw new TypeError('onContinue is required');
  const c={...defaults,...theme},content=model.welcome({name,subtitle,steps,copy,translate});
  return h(View,{style:{gap:16,backgroundColor:c.surface,padding:24}},
    h(View,{style:{flexDirection:'row',alignItems:'center',gap:12}},h(Image,{source:logo,accessible:false,style:{width:42,height:42}}),h(View,null,h(Text,{style:{fontSize:21,fontWeight:'700',color:c.ink}},content.name),h(Text,{style:{fontSize:12,color:c.muted}},content.subtitle))),
    h(Text,{accessibilityRole:'header',style:{fontSize:29,fontWeight:'700',color:c.ink}},content.title),
    h(Text,{style:{fontSize:15,color:c.muted}},content.eyebrow),h(Text,{style:{fontSize:15,lineHeight:24,color:c.muted}},content.description),
    ...content.steps.map((step,i)=>h(View,{key:i,style:{flexDirection:'row',alignItems:'center',gap:12,minHeight:44}},h(Text,{style:{color:c.accent,fontWeight:'600'}},String(i+1)),h(Text,{style:{flex:1,color:c.ink,fontSize:14}},step))),
    h(Pressable,{accessibilityRole:'button',onPress:onContinue,style:({pressed})=>({minHeight:48,padding:12,borderRadius:12,backgroundColor:c.accent,opacity:pressed ? .8 : 1,justifyContent:'center',alignItems:'center'})},h(Text,{style:{color:c.accentInk,fontWeight:'600',fontSize:15}},content.continueLabel)));
}
module.exports={ConnectionMethods,ConnectionWelcome};
