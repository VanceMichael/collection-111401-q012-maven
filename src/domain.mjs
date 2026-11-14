import {capture} from './client.mjs';
export async function receiveCurrent(base,directory){
 const index=await capture(base+'/repository/metadata',directory);const order=JSON.parse(index.bytes);const source=await capture(base+order.metadata,directory);return {coordinates:[order.groupId,order.artifactId,order.version],metadata:source.receipt.id,bytes:source.bytes.length};
}
