// In-memory R2 contract used by API tests, including conditional writes and paging.
import {createHash} from 'node:crypto';
const etag=value=>createHash('sha256').update(value).digest('hex');
export function testBucket(objects,pageSize=1000) {
  return {
    async get(key) {
      const value=objects.get(key);
      return value===undefined?null:{etag:etag(value),json:async()=>JSON.parse(value)};
    },
    async put(key,value,options={}) {
      if(options.onlyIf?.etagMatches!==undefined && (!objects.has(key) || etag(objects.get(key))!==options.onlyIf.etagMatches))return null;
      if(options.onlyIf?.etagDoesNotMatch==='*' && objects.has(key))return null;
      objects.set(key,value);
      return {etag:etag(value)};
    },
    async delete(key){objects.delete(key);},
    async list({prefix='',cursor,limit=1000}={}) {
      const keys=[...objects.keys()].filter(key=>key.startsWith(prefix)).sort();
      const start=cursor?keys.findIndex(key=>key>cursor):0;
      if(start<0)return {objects:[],truncated:false};
      const page=keys.slice(start,start+Math.min(limit,pageSize));
      const truncated=start+page.length<keys.length;
      return {objects:page.map(key=>({key})),truncated,...truncated?{cursor:page.at(-1)}:{}};
    }
  };
}
