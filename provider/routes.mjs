import { createHash } from 'node:crypto';
export const initialState = { generation: 1, mode: 'normal', clock: 1000 };
export async function stop(state) {  }
export async function routes(context) {
 const { request, url, body, payload, state, json, text, binary } = context;

 const build=state.generation===1?'20261114.090000-1':'20261114.093000-2';
 if(url.pathname==='/repository/metadata')return json({groupId:'local.devices',artifactId:'protocol',version:'1.2-SNAPSHOT',metadata:'/repository/local/devices/protocol/1.2-SNAPSHOT/maven-metadata.xml',required:[{extension:'zip',classifier:''},{extension:'xml',classifier:'schema'}],optional:[{extension:'txt',classifier:'notes'}]});
 if(url.pathname.endsWith('/maven-metadata.xml'))return text(`<metadata><groupId>local.devices</groupId><artifactId>protocol</artifactId><version>1.2-SNAPSHOT</version><versioning><snapshot><timestamp>${build.split('-')[0]}</timestamp><buildNumber>${state.generation}</buildNumber></snapshot><snapshotVersions><snapshotVersion><extension>zip</extension><value>1.2-${build}</value><updated>20261114093000</updated></snapshotVersion><snapshotVersion><classifier>schema</classifier><extension>xml</extension><value>1.2-${build}</value><updated>20261114093000</updated></snapshotVersion></snapshotVersions></versioning></metadata>`,200,{'content-type':'application/xml',etag:'"build-'+state.generation+'"'});
 if(url.pathname.includes('/protocol-1.2-')){
   if(!url.pathname.includes(build))return json({error:'此次构建文件已移走'},404);
   if(url.pathname.endsWith('-notes.txt'))return json({error:'没有发布可选说明'},404);
   if(state.mode==='publishing'&&url.pathname.endsWith('-schema.xml'))return json({error:'文件仍在发布'},503);
   const artifactPath=url.pathname.endsWith('.sha256')?url.pathname.slice(0,-7):url.pathname;
   const content=Buffer.from(artifactPath.endsWith('.xml')?'<schema version="'+build+'"/>':'protocol-'+build);
   if(url.pathname.endsWith('.sha256'))return text(createHash('sha256').update(content).digest('hex')+'\n');
   return binary(content,'application/octet-stream',{'x-build':build});
 }

}
