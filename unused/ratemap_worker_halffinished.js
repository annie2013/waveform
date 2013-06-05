"use strict";

//TODO: finish this and push as much as possible into a worker

T.RM = function(BYTES_PER_SPIKE,BYTES_PER_POS_SAMPLE,$tile_,POS_NAN){

	var WORKER_STRING = function(){
		var spikePosBinXY;
		var smoothedDwellCounts;
		var unvisitedBins;
		var nBinsX, nBinsY, nBinsTot;//nBinsTot is just nBinsX *nBinsY
		var P_COLORS = 5; //0th entry in palette is white, then p colors
		var tetBuffer = null; //these buffers are reset to null immediately after use
		var posBuffer = null;
		var BYTES_PER_SPIKE,BYTES_PER_POS_SAMPLE,POS_NAN;
		//matricies will be stored in the following order x1y1 x2y1 x3y1 ... xny1 x1y2 .... which is how imagedata wants it
			
		var vector32 = function(n){
			return new Uint32Array(new ArrayBuffer(n*4));
		}
		var vector8 = function(n){ //I think this my be kind of redundant because you don't need to explicitly create the arraybuffer, can j
			return new Uint8ClampedArray(new ArrayBuffer(n*1));
		}

		var GetSmoothed = function(matrix){
			var result = vector32(nBinsTot);
			var W = 2; //kernle is box-car of size 2W+1
			
			for(var ky=-W;ky<=W;ky++)for(var kx=-W;kx<=W;kx++){//for each offset within the kernel square
				var y0 = ky<0? 0 : ky;
				var x0 = kx<0? 0 : kx;
				var yend = ky>0? nBinsY : nBinsY+ky;
				var xend = kx>0? nBinsX : nBinsX+kx;
				
				for(var y=y0;y<yend;y++)for(var x=x0;x<xend;x++)
					result[y*nBinsX +x] += matrix[(y-ky)*nBinsX +(x-kx)];
					
			}	
			return result; 
		}

		var accumarray = function(indsXY){
			//This function has aspirations to match the magnificence of its Matlab namesake.  Currently it is rather more simple.
			
			//assume size nBinsX and nBinsY. 
			var result = vector32(nBinsTot);
			var n = indsXY.length/2;
			for(var i=0;i<n;i++)
				result[indsXY[i*2+0]*nBinsX + indsXY[i*2+1]]++;
			
			return result;
		}
		
		var pick = function(from,indices){
			var result =  new from.constructor(indices.length); //make an array of the same type as the from array
			
			for(var i=0;i<indices.length;i++)
				result[i] = from[indices[i]];
				
			return result;
		}
		
		var max = function(X){
			return Math.max.apply(null,X);
		}
		
		var min = function(X){
			return Math.min.apply(null,X);
		}
		
		var rdivide = function(numerator,denominator){
			//note that this returns a float array no matter what class the numerator and denonminator are
			var result = new Float32Array(numerator.length);
			for(var i=0;i<numerator.length;i++)
				result[i] = numerator[i]/denominator[i];
			return result;
		}
		
		var UseMask = function(vector,mask){
			//sets vector elemnts to zero where mask is true
			for(var i=0;i<mask.length;i++)
				if(mask[i])
					vector[i] = 0;
			//modifies vector in place
		}
		
		var IsZero = function(vector){
			var result = vector8(vector.length);
			for(var i=0;i<vector.length;i++)
				result[i] = (vector[i]==0);
			return result;
		}
		
		//Note about endian-ness:
		// if required, T.PAR will swap pairs of bytes when reading the pos file, which makes sense for x and y data but not for timestamps
		// (so the timestamps in pos data are screwed up, but we don't actually bother to read them , we assume constant sampling at the stated freq)
		// tetrode data is mostly single bytes so nothing is done to it at the point of loading, this means that here we may need to swap the bytes of 
		//the 4-byte timestamps.  See GetPosInds function for more.
		var Swap32 = function(val) {
			return ((val & 0xFF) << 24)
				   | ((val & 0xFF00) << 8)
				   | ((val >> 8) & 0xFF00)
				   | ((val >> 24) & 0xFF);
		}
		
		var endian = (function(){
			var b = new ArrayBuffer(2);
			(new DataView(b)).setInt16(0,256,true);
			return (new Int16Array(b))[0] == 256? 'L' : 'B';
		})();
		
		var GetPosInds = function(buffer,N,tetFreq,posFreq){
			//reads timestamps and converts to posSample index
			
			var oldData = new Int32Array(buffer);
			var posInds = vector32(N);
			
			for(var i=0; i<N; i++) //get the timestamp for each spike
				posInds[i] = oldData[BYTES_PER_SPIKE/4*i]; //we are accessing the buffer as 4byte ints, we want the first 4bytes of the i'th spike
				
			
			if (endian == 'L') 
				for(var i=0;i<N; i++)
					posInds[i] = Swap32(posInds[i]);
			
			var factor = 1/tetFreq * posFreq;
			for(var i=0;i<N;i++)
				posInds[i] = Math.ceil(posInds[i]*factor);
			
			return posInds;
		}

		var Setup = function(){
			var posInds = GetPosInds(tetBuffer,Ntet,tetFreq,posFreq);
			var posBinXY = vector8(2*Npos); // xBin, yBin, xBin , yBin, ... bin numbers from 0 to 255. 
			
			var factor = 1/pixPerM * 100 /cmPerBin;	
			
			var posData = new Int16Array(posBuffer);
			//TODO: subtract min in x and y, deal with POS_NAN
			
			var wordsPerPosSample = BYTES_PER_POS_SAMPLE/2;

			for(var i=0; i<Npos;i++){
				var s = wordsPerPosSample*i;
				if(posData[s+2]!=0 && posData[s+3]!=0 && posData[s+2]!=POS_NAN && posData[s+3]!=POS_NAN){
					posBinXY[i*2 + 0] = posData[s+2]*factor; //x value
					posBinXY[i*2 + 1] = posData[s+3]*factor; //y value
				}
			}

			var tmp = vector8(Npos);
			for(var i=0;i<Npos;i++)
				tmp[i] = posBinXY[2*i+0];
			nBinsX =  max(tmp) + 1;//+1 because of zero
			
			for(var i=0;i<Npos;i++)
				tmp[i] = posBinXY[2*i+1];
			nBinsY =  max(tmp) + 1;
			
			nBinsTot = nBinsX*nBinsY;
			
			//since the only thing we really care about is pos bins, its the posbinX and posbinY we store for each spike
			spikePosBinXY=vector8(2*Ntet); //same form as posBinXY
			for(var i=0;i<Ntet;i++){
				spikePosBinXY[2*i +0] = posBinXY[posInds[i]*2 +0];
				spikePosBinXY[2*i +1] = posBinXY[posInds[i]*2 +1];
			}
			
			var dwellCounts = accumarray(posBinXY);
			dwellCounts[0] = 0;//this is where bad points were put, this is a quick fix
			
			//before we do the smoothing we need to remmber which bins were unvisted
			unvisitedBins = IsZero(dwellCounts);
				
			//ok now we do the smoothing
			smoothedDwellCounts = GetSmoothed(dwellCounts);
			
			tetBuffer = null; posBuffer = null;
			//TODO: if division really is slow, it may even be while inverting all the elements in the smoothedDwellCounts matrix
		}
		
		var SetGroupData = function(cutInds,firstGroup,lastGroup){
			// the function only looks at the elements in cutInds between first and last group, though they can be null or undefined in which case it does the whole of cutInds
			//for each cutGroup it builds a spikeCount map, smooths it, divides by the dwell count, applies a colorpalette to the result and outputs a matrix to be used as image data.
			//For each cutGroup the peak rate is stored in an array and output at the end as a single list.
			//by output here we mean postmessage
			for(var g=firstGroup;g<=lastGroup;g++)if(cutInds[g]){
				var groupPosIndsXY = pick(new Uint16Array(spikePosBinXY.buffer),cutInds[g]); //we treat the posXY data as 2byte blocks here
				var spikeCounts = accumarray(new Uint8Array(groupPosIndsXY.buffer)); //now we treat it as 1 byte blocks again
				spikeCounts[0] = 0; //it's the bad bin, remember
				
				var smoothedSpikeCounts = GetSmoothed(spikeCounts);
				var ratemap = rdivide(smoothedSpikeCounts,smoothedDwellCounts)
				var ratemap = smoothedSpikeCounts;
				UseMask(ratemap,unvisitedBins);
				
				var im = ToImageData(ratemap);
				ShowGroupImage(im,g); //TODO: this should be a post message, need a way to find out what g is on reciever end (either an extra post message or track the incoming messages and increment g on the other end
			}
		}
		
		var PALETTE = function(){
			var buffer = new ArrayBuffer(4*(P_COLORS+1));
			var buf8 = new Uint8Array(buffer);
			
			//set all alpha values to opaque
			for(var i=0;i<=P_COLORS;i++)
				buf8[i*4+3] = 255;
			
			buf8[0*4+0]= 255; buf8[0*4+1]=255; buf8[0*4+2]=255; //white
			
			buf8[1*4+2]= 198;
			buf8[2*4+1]= 162; buf8[2*4+2]= 255; 
			buf8[3*4+0]= 56; buf8[3*4+1]= 235; buf8[3*4+2]=32; 
			buf8[4*4+0]= 248; buf8[4*4+1]=221; 
			buf8[5*4+0]= 255; buf8[5*4+1]= 32;
					
			return new Uint32Array(buffer); //this is how ToImageData function wants it
		}();
		
		var ToImageData = function(map){
			//we use PALETTE which is a Uint32Array, though really the underlying data is 4 bytes of RGBA
			
			var buffer = new ArrayBuffer(nBinsTot*4);
			var im = new Uint32Array(buffer);//4 because RGBA each of which is 1 byte
			
			 //for binning, we want values on interval [1 P], so use eps (lazy solution):
			var eps = 0.0000001;
			
			var factor = 1/max(map)*P_COLORS*(1-eps);
			var i = 0;
			
			for(var i=0;i<nBinsTot;i++)
				im[i] = unvisitedBins[i]? PALETTE[0] : PALETTE[1+Math.floor(map[i]*factor)];
			
			return new Uint8ClampedArray(buffer); //this is how it's going to be used by ShowGroupImage
		}
	
		var state = null;
		
		self.onmessage = function(e){
			var data = e.data;

			if(data.params !== undefined){
				if(data.Ntet !== undefined)
					Ntet = data.Ntet;
				if(data.Npos !== undefined)
					Npos = data.Npos
				if(data.tetFreq !== undefined)
					tetFreq = data.tetFreq
				if(data.posFreq !== undefined)
					posFreq = data.posFreq;
				if(data.pixPerM !== undefined)
					pixPerM = data.pixPerM;
				if(data.cmPerBin !== undefined)
					cmPerBin = data.cmPerBin;
				if(data.BYTES_PER_SPIKE !== undefined)
					BYTES_PER_SPIKE = data.BYTES_PER_SPIKE;
				if(data.BYTES_PER_POS_SAMPLE !== undefined)
					BYTES_PER_POS_SAMPLE = data.BYTES_PER_POS_SAMPLE;
				if(data.POS_NAN !== undefined)
					POS_NAN = data.POS_NAN;
					
			}else if(data.state !== undefined){
				state = data.state; //this means the next message will be either posBuffer or tetBuffer
			}else{
				if(state==1)
					tetBuffer = data;
				else if(state ==2)
					posBuffer = data;
				state = null;
			}
			
			if(!(tetBuffer == null || posBuffer == null)) //ought to check other vars too but whatever
				Setup();

		}
	}.toString().match(/^\s*function\s*\(\s*\)\s*\{(([\s\S](?!\}$))*[\s\S])/)[1];

	var theWorker = new Worker(window.URL.createObjectURL(new Blob([WORKER_STRING],{type:'text/javascript'})));
	
	
	var nBinsX, nBinsY, g;
	//=================================================
	
	theWorker.onmessage = function(e) {
    	//e.data
		
		
    }
	
	var Setup = function(tetBuffer,posBuffer,Ntet,Npos,tetFreq,posFreq,pixPerM,cmPerBin){
		theWorker.postMessage({ params:true,Ntet:Ntet,Npos:Npos,tetFreq:tetFreq,
								posFreq:posFreq,pixPerM:pixPerM,cmPerBin:cmPerBin,
								BYTES_PER_SPIKE: BYTES_PER_SPIKE,BYTES_PER_POS_SAMPLE:BYTES_PER_POS_SAMPLE,
								POS_NAN:POS_NAN});

		/* TODO: this is a problem, we have several options:
		1. copy the two buffers to the worker in full
		2. do the setup processing in the main thread and only send the inds (which we are smaller and have to be made anyway)
		3. abandon worker entierly
		4. send the only version of the two buffers to the worker, but only after we have done everything else with them on the main thread
		5. send the only version of the two buffers to the worker, and then send it back when we are done
		6. send the only version of the two buffers to the worker, but then have that worker be more general, i.e. make it be the one to generate vertices for webgl
		Option 6 might be the best but mixing up different things inside the worker is going to be a bit annoying.  Though could potentially do it by having a basic worker that reads in the two buffers
		and then pipes messages to other functions based on a single parameter.  The individual modules could then register their code with the worker before it is initialised and will then be able to use it
		separately.  To keep it all safe would be best to keep each block of code in the worker enclosed in its own function.
		Will also need a way to pipe received messages back out again.  Time to write a module!
		*/ 
		
		theWorker.postMessage({state:1}); //1=tetBuffer
		theWorker.postMessage(tetBuffer,[tetBuffer]);
		theWorker.postMessage({state:2}); //2=posBuffer
		theWorker.postMessage(posBuffer,[posBuffer]);

	}
	
	var SetGroupData = function(cutInds,firstGroup,lastGroup){
	
		
	}
	
	var dummyCanvasCtx = $('<canvas/>').get(0).getContext('2d');
	
	var ShowGroupImage =function(im,ind){

		if(!$tile_[ind]) return;
		
		var imData = dummyCanvasCtx.createImageData(nBinsX,nBinsY);
		var nBytes = nBinsX*nBinsY*4;
		for(var i=0;i<nBytes;i++)
			imData.data[i] = im[i];
			
		$tile_[ind].canvas.get(1).width = nBinsX;
		$tile_[ind].canvas.get(1).height = nBinsY;
		$tile_[ind].canvas.eq(1).css({width: nBinsX*2 + 'px', height: nBinsY*2 + 'px'});
		$tile_[ind].ctx2.putImageData(imData, 0, 0);
		
	}
	
	return {
		Setup: Setup,
		SetGroupData: SetGroupData
	}
	
}(T.BYTES_PER_SPIKE,T.BYTES_PER_POS_SAMPLE,T.$tile_,T.POS_NAN)



T.RatemapsDev = function(){
	//this is not a proper implementation yet
	var correction = 3.9;
	T.RM.Setup(T.buffer,T.posBuffer,parseInt(T.N),parseInt(T.posHeader.num_pos_samples),
				parseInt(T.header.timebase),parseInt(T.posHeader.sample_rate),parseInt(T.posHeader.pixels_per_metre),2.5*correction);
	T.RM.SetGroupData(T.cutInds,0,12);
}
$('#ratemaps_button').click(T.RatemapsDev);