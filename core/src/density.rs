//! Cached waveform-density rasterisation from the bounded waveform reservoir.
use crate::Engine;
use std::slice;
const W:usize=512;const H:usize=128;
impl Engine{
 fn density_for(&mut self,cell:u16){
  if self.density.contains_key(&cell){return;}
  let mut map=vec![0u16;W*H];
  for(i,&index)in self.samples.indices.iter().enumerate(){if self.labels[index as usize]!=cell{continue;}
   let wave=&self.samples.waves[i*200..i*200+200];
   for c in 0..4{for t in 0..49{
    let(mut x,mut y)=((c*128+10+t*107/49)as i32,(64.-wave[c*50+t]as f32*0.39).round()as i32);
    let(x1,y1)=((c*128+10+(t+1)*107/49)as i32,(64.-wave[c*50+t+1]as f32*0.39).round()as i32);
    let dx=(x1-x).abs();let sx=if x<x1{1}else{-1};let dy=-(y1-y).abs();let sy=if y<y1{1}else{-1};let mut err=dx+dy;
    loop{if (0..W as i32).contains(&x)&&(0..H as i32).contains(&y){let p=&mut map[y as usize*W+x as usize];*p=p.saturating_add(1);}if x==x1&&y==y1{break;}let e2=2*err;if e2>=dy{err+=dy;x+=sx;}if e2<=dx{err+=dx;y+=sy;}}
   }}
  }
  self.density.insert(cell,map);
 }
}
#[no_mangle]pub unsafe extern "C" fn engine_density(e:*mut Engine,cells:*const u16,n:usize){let e=&mut*e;let cells=slice::from_raw_parts(cells,n);for &c in cells{e.density_for(c);}e.density_atlas.clear();e.density_atlas.reserve(n*W*H);for c in cells{e.density_atlas.extend_from_slice(e.density.get(c).unwrap());}}
#[no_mangle]pub unsafe extern "C" fn engine_density_ptr(e:*const Engine)->*const u16{(*e).density_atlas.as_ptr()}
#[no_mangle]pub unsafe extern "C" fn engine_density_len(e:*const Engine)->usize{(*e).density_atlas.len()}
