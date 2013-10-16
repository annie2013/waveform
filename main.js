"use strict";

var T = {};
T.Tool = {};
T.chanIsOn = [1,1,1,1];
T.mapIsOn = [0];
T.tAutocorrIsOn = 0;
T.paletteMode = 0;
T.binSizeCm = 2.5;

T.BYTES_PER_SPIKE = 4*(4 + 50);
T.BYTES_PER_POS_SAMPLE = 4 + 2 + 2 + 2 + 2 + 2 + 2 + (2 + 2);//the last two uint16s are numpix1 and bnumpix2 repeated
T.POS_NAN = 1023; 

T.BASE_CANVAS_WIDTH = 4*49;
T.BASE_CANVAS_HEIGHT = 256;
T.CANVAS_NUM_WAVE = 0;
T.CANVAS_NUM_RM = 1;
T.CANVAS_NUM_TC = 2;
T.POS_PLOT_WIDTH = 200;
T.POS_PLOT_HEIGHT = 200;
T.DISPLAY_ISON = {CHAN: [1,2,3,4], RM: [101], TC: 201, //value attribute in DOM
				  CHAN_: [0,1,2,3], RM_: [4], TC_: 5}; //order in DOM
				  
T.DISPLAYAUTOCORR_START = 201-1;
T.xFactor = 2;
T.yFactor = 2;
T.SPECIAL_SCALING = 0.5; //this scaling factor makes the size values presented to the user a bit nicer
T.SPECIAL_SCALING_RM = 2; //this makes ratemaps bigger
T.TILE_MIN_HEIGHT = 128; //TODO: look this up from css rather than state it here manually

T.$newTile = $("<div class='tile'>" +
			"<canvas width='0' height='0' style='width:0px;height:" + T.TILE_MIN_HEIGHT + "px;'></canvas>" + 
			"<canvas width='0' height='0' style='width:0px;height:" + T.TILE_MIN_HEIGHT + "px;'></canvas>" +
			"<canvas width='0' height='0' style='width:0px;height:" + T.TILE_MIN_HEIGHT + "px;'></canvas>" +
			"<div class='tile-over'><div class='tile-caption'></div></div>" + 
			"<div class='blind'></div>" + 
			"</div>");		//this gets cloned and appended to $tilewall


T.PlotPos = function(){
	var buffer = T.ORG.GetPosBuffer();

	var ctx = T.$posplot.get(0).getContext('2d');
	ctx.clearRect(0 , 0 , T.POS_PLOT_WIDTH, T.POS_PLOT_HEIGHT);

	if(buffer == null) return;

	var data = new Int16Array(buffer);
	var header = T.ORG.GetPosHeader();
	var elementsPerPosSample = T.BYTES_PER_POS_SAMPLE/2;
	var end = parseInt(header.num_pos_samples) * elementsPerPosSample; 
	var xs = T.POS_PLOT_WIDTH/(parseInt(header.window_max_x)-parseInt(header.window_min_x));
	var ys = T.POS_PLOT_HEIGHT/(parseInt(header.window_max_y)-parseInt(header.window_min_y));
	var s = xs<ys? xs: ys;//min of the two
	ctx.beginPath();
	ctx.strokeStyle = "RGB(0,0,0)";
	var i = 2;
	ctx.moveTo(data[i]*s,data[i+1]*s);
	for(;i<end;i+=elementsPerPosSample)if(data[i] != T.POS_NAN && data[i+1] != T.POS_NAN && data[i] && data[i+1])
		ctx.lineTo(data[i]*s,data[i+1]*s);
	ctx.stroke();
}


T.FinishedLoadingFile = function(status,filetype){
	//status is an object with a field for each of the file types ["pos","set","tet","cut"] the values have the following meanings:
	//	0 - file does not exist
	//	1 - file exists but has not been delivered here yet
	//  2 - this is the file currently being delievered - see the data object
	//  3 - file has already been delivered
	//  Note that in each round of loading files there will be an initial call with a null filetype, indicating what ui data needs to be flushed.
	// filetype just tells us which item in status is 2, or is null if none of them are.

	console.log("FinishedLoadingFile(" + JSON.stringify(status) + ", " + filetype + ")");

	T.DispHeaders(status,filetype); //if null, then it displays all (which could still be something if T.PAR.Get*Header isn't null)

	if(filetype == null){
		if(status.tet < 3){
			T.WV.LoadTetrodeData(null);	
			T.RM.LoadTetData(null);
			T.TC.LoadTetrodeData(0);
			T.PlotPos();
		}
		if(status.cut < 3){
			T.ClearAllTiles();
			T.CutActionCallback(null,{num:0,type:"load",description:"no active cut"});
		}
		if(status.pos < 3){
			T.RM.LoadPosData(null);
			T.PlotPos();
		}
	}
	
	if(filetype == "tet"){
		T.WV.LoadTetrodeData(T.ORG.GetN(),T.ORG.GetTetBuffer());
		T.TC.LoadTetrodeData(T.ORG.GetN(),T.ORG.GetTetBuffer(),parseInt(T.ORG.GetTetHeader().timebase));
		T.RM.LoadTetData(T.ORG.GetN(),T.ORG.GetTetBuffer(),parseInt(T.ORG.GetTetHeader().timebase));
		
		if(status.cut == 3){ //if we happened to have loaded the cut before the tet, we need to force T.WV, T.TC, and T.RM to accept it now
			T.ORG.GetCut().ForceChangeCallback(T.WV.SlotsInvalidated);
			T.ORG.GetCut().ForceChangeCallback(T.TC.SlotsInvalidated);
			T.ORG.GetCut().ForceChangeCallback(T.RM.SlotsInvalidated);
		}
	}

	if(filetype == "pos"){
		T.PlotPos();
		var posHeader = T.ORG.GetPosHeader();
		T.RM.LoadPosData(parseInt(posHeader.num_pos_samples), T.ORG.GetPosBuffer(),parseInt(posHeader.timebase),parseInt(posHeader.pixels_per_metre));
		if(status.cut == 3){ //if we happened to have loaded the cut before the tet, we need to force T.RM to accept it now
			T.ORG.GetCut().ForceChangeCallback(T.RM.SlotsInvalidated);
		}
	}
		
	//note that cut is mainly dealt with separetly by the callbacks registered with the T.CUT module
}


T.DispHeaders = function(status,filetype){
	//TODO: if filetype is null then display all, otherwise only display the one given by the filetype string ["tet","set", etc.]
	var headerTypeList = ["tet","cut","pos","set"];
	var headerlist = [T.ORG.GetTetHeader(),T.ORG.GetCutHeader(),T.ORG.GetPosHeader(),T.ORG.GetSetHeader()];
    var tet = T.ORG.GetTet();
	var headernames = ['.' + tet +' file (spike data)','_' + tet + '.cut file','.pos file','.set file'];

	for(var i=0,hdr=headerlist[0];i<headerlist.length;hdr=headerlist[++i])
		if(hdr && filetype==headerTypeList[i]){
			var strbuilder = [];
			var hdr = headerlist[i];
			for(var k in hdr)if(hdr.hasOwnProperty(k))
				strbuilder.push("<td class='header_field_name'>" + k + "</td><td class='header_field_value'>" + hdr[k] + '</td>');
			T.$file_info[i].html(headernames[i] + "<table><tbody><tr>" + strbuilder.join("</tr><tr>") + "</tr></tbody></table>")
			T.$file_info[i].show();
		}else if(status[headerTypeList[i]]<2){
			T.$file_info[i].hide();
		}

	T.FilterHeader();
}



T.SetDisplayIsOn = function(v){ 

	//there are currently 6 buttons: the first 4 are channels, then 1 for ratemap and 1 for temporal autocorr
	//this function will 
	if('chanIsOn' in v){
		T.chanIsOn = v.chanIsOn; //array of 4
		for(var i=0;i<T.DISPLAY_ISON.CHAN.length;i++)
			T.$chanButton_.eq(T.DISPLAY_ISON.CHAN_[i]).prop('checked',T.chanIsOn[i])
		T.WV.ShowChannels(T.chanIsOn);
	}
	
	if('mapIsOn' in v){
		T.mapIsOn = v.mapIsOn; //array of 1
		for(var i=0;i<T.DISPLAY_ISON.RM.length;i++)
			T.$chanButton_.eq(T.DISPLAY_ISON.RM_[i]).prop('checked',T.mapIsOn[i])
		T.RM.SetShow(T.mapIsOn);
	}
	
	if('tAutocorrIsOn' in v){
		T.tAutocorrIsOn = v.tAutocorrIsOn; //1 or 0 (not an array)
		T.$chanButton_.eq(T.DISPLAY_ISON.TC_).prop('checked',T.tAutocorrIsOn)
		T.TC.SetShow(T.tAutocorrIsOn);
	}
	
}

T.DisplayIsOnClick = function(evt,keyboard){
	//displayIsOn are the 6 buttons: 4xchannel 1xratemap 1xtemporal-autocorr
	
	//TODO: change "Channel" in button names to reflect the fact it now includes maps. Also can now be called as a keyboard shortcut
	// in which case this is not set and keyboard has the info not evt.
	
	//Also need to convert buttons to be actuall buttons rather than radio inputs becaues firefox doesn't permit clicking radio buttons with ctrl or alt or shift pressed (I think)

	var oldChans = T.chanIsOn;
	var oldMaps = T.mapIsOn;
	var oldTautocorr = T.tAutocorrIsOn;
	
	var thisVal = keyboard ? keyboard.val : parseInt($(this).val());
	var shiftKey = keyboard ? keyboard.shiftKey : evt.shiftKey;
	var setChans; var setMaps; var setTautocorr;

	if(shiftKey){
		//if ctrl key is down then at least keep the old values
		setChans = oldChans.slice(0);
		setMaps = oldMaps.slice(0);
		setTautocorr = oldTautocorr;
	}else{
		//if ctr key is not down then we start with a blank slate
		setChans = [0,0,0,0];
		setMaps = [0];
		setTautocorr = 0;
	}
	
	if(thisVal == T.DISPLAY_ISON.TC){
		//clicked temporal autocorr button (there's no array, it's just a single button)
		setTautocorr = shiftKey ? !setTautocorr : 1;
	}else for(var i=0;i<T.DISPLAY_ISON.RM.length; i++) if(thisVal == T.DISPLAY_ISON.RM[i]){
		//clicked the i'th ratemap button (there is currently only one available)
		setMaps[i] = shiftKey ? !setMaps[i] : 1;
	}else for(var i=0;i<T.DISPLAY_ISON.CHAN.length;i++)if(thisVal == T.DISPLAY_ISON.CHAN[i]){
		//clicked the i'th channel button (of which there are 4)
		setChans[i] = shiftKey ? !setChans[i] : 1;
	}
		
	if(shiftKey && (M.sum(setChans) + M.sum(setMaps) + setTautocorr == 0)){
		//if ctrl key was down and we are about to turn off the one and only display we should abort that, and keep what we had
		setChans = oldChans; 
		setMaps = oldMaps;
		setTautocorr = oldTautocorr;
	}
	
	T.SetDisplayIsOn({chanIsOn: setChans, mapIsOn: setMaps, tAutocorrIsOn: setTautocorr});
}


T.ApplySizeClick = function(){
	var new_scale = Math.floor(T.$size_input.val()); 
	new_scale = isNaN(new_scale)? 2 : new_scale;
	new_scale = new_scale < 1? 1 : new_scale;
	new_scale = new_scale > 8? 8 : new_scale;
	T.$size_input.val(new_scale);
	T.xFactor = new_scale;
	T.yFactor = new_scale;

	T.ApplyCanvasSizes();
}

T.ApplyRmSizeClick = function(){
	var new_scale = Math.floor(T.$rm_bin_size.val()*10)/10; //round to 1 d.p.
	new_scale = isNaN(new_scale)? 2.5 : new_scale;
	new_scale = new_scale < 0.5? 0.5 : new_scale;
	new_scale = new_scale > 20? 20 : new_scale;
	T.$rm_bin_size.val(new_scale);
	T.binSizeCm = new_scale;

	T.RM.SetCmPerBin(new_scale);
}



T.ApplyCanvasSizes = function(){
	
	var i = T.tiles.length;
	while(i--)if(T.tiles[i]){
		var $c = T.tiles[i].$.find('canvas').eq(0);
		$c.css({width: $c.get(0).width * T.xFactor*T.SPECIAL_SCALING  + 'px',height: $c.get(0).height * T.yFactor*T.SPECIAL_SCALING  + 'px'});
	}
}


T.StoreData = function(){
	localStorage.chanIsOn = JSON.stringify(T.chanIsOn);
	localStorage.tet = T.ORG.GetTet();
	localStorage.xFactor = T.xFactor;
	localStorage.yFactor = T.yFactor;
	
	//TODO store cuts
	localStorage.FSactive = T.FS.IsActive();
	localStorage.BIN_SIZE_CM = T.binSizeCm;
	localStorage.state = 1;

}



//for each cut slot, these two arrays track the updates applied during calls to SetGroupDataTiles
T.cutSlotToTileMapping = [];

T.canvasUpdatedListeners = []; //this allows T.Tool (and potentially other things) to listen for new canvases
T.AddCanvasUpdatedListener = function(foo){
	T.canvasUpdatedListeners.push(foo);
}
T.RemoveCanvasUpdatedListener = function(foo){
	for(var i=0;i<T.canvasUpdatedListeners.length;i++)if(T.canvasUpdatedListeners[i] == foo){
		T.canvasUpdatedListeners.splice(i,1);
		return;
	}
}


T.CutSlotCanvasUpdate = function(slotInd,canvasNum,$canvas){
	//this callback recieves the newly rendered canvases from the waveform rendering and ratemap rendering modules
	//these rendering modules recieve slot-invalidation events directly from the cut module and can choose to ignore them or
	//spend any length of time rendering a new canvas.  They must hwoever guarantee to call this function in chronological order for
	//the invalidation events on each slot. When a group number changes for a given slot the canvas will follow the group, so that if it 
	//doesn't need to be re-rendered it will be in the right place.  Also, if rendering paramaters are changed the rendering modules may need
	//to issue updated canvases without any slot-invalidation events being received by SetGroupDataTiles.
	//slotInd matches the cut immutables slot thing, canvasNum is 0 for waveforms and 1 for ratemaps.
	var g = T.cutSlotToTileMapping[slotInd];
	var t = T.tiles[g];
	if(!t)
		return;
		
	if($canvas)	{
		var xF = 1;
		var yF = 1;
        switch (canvasNum){
			case T.CANVAS_NUM_WAVE:
				xF = T.xFactor*T.SPECIAL_SCALING;
				yF = T.yFactor*T.SPECIAL_SCALING;
				break;
			case T.CANVAS_NUM_RM:
				xF = T.SPECIAL_SCALING_RM;
				yF = T.SPECIAL_SCALING_RM;
				break;
			case T.CANVAS_NUM_TC:
				// for temporal autocorr leave it at 1
				break;
		}
		$canvas.css({width: $canvas.get(0).width *xF + 'px',height: $canvas.get(0).height *yF  + 'px'}); //apply css scaling
    }else
		$canvas = $("<canvas width='0' height='0' style='width:0px;height:" + T.TILE_MIN_HEIGHT + "px;'></canvas>"); //create a zero-size canvas if we weren't given anything
	
	t.$.find('canvas').eq(canvasNum).replaceWith($canvas); 
	
	for(var i=0;i<T.canvasUpdatedListeners.length;i++)
		T.canvasUpdatedListeners[i](canvasNum,$canvas,g);
}

T.CreateTile = function(i){
	var $ = T.$newTile.clone();
	
	$.data("group_num",i);
	return {$: $,
			caption: $.find('.tile-caption')
			}

}

T.SetGroupDataTiles = function(cut,invalidatedSlots_,isNew){
	//controls the adding, removing, rearanging, and caption-setting for tiles. (Unfortunately the logic is a bit complicated)

	var maxGroupNum = cut.GetProps().G; 
	var invalidatedSlots = M.clone(invalidatedSlots_); //we want our own copy for this function to modify
	
	while(T.tiles.length <= maxGroupNum){ //if there are too few tiles, add more
		var t = T.CreateTile(T.tiles.length-1);
		T.$tilewall.append(t.$);
		t.$.hide();
		T.tiles.push(t);
	}

	
	var slotCache = Array(invalidatedSlots.length); //this means we only have to call cut.GetImmutableSlot(k) once for each invalidated slot (even though we have two for loops below)
	for(var k=0;k<invalidatedSlots.length;k++)if(invalidatedSlots[k]){ //for every invalidated slot....
		var slot_k = slotCache[k] = cut.GetImmutableSlot(k); //get the slot
		if(slot_k.inds == null  || slot_k.inds.length==0 ){ //check if immutable has been cleared (or maybe it never contaiend anything)
			var old_tile_ind = T.cutSlotToTileMapping[k];
			if(isNum(old_tile_ind)){
				//hide the tile if one was associated to the slot
				T.tiles[old_tile_ind].$.hide(); 
				T.cutSlotToTileMapping[k] = null;
			}
			invalidatedSlots[k] = 0; //by getting rid of any existing tile for the slot we have just validated this slot
		}
	}
	
	var displaced_tiles = []; //if we move tiles around during the loop we store the displaced tiles in this array so that they can be used by subsequent iterations if needed
	for(var k=0;k<invalidatedSlots.length;k++)if(invalidatedSlots[k]){ //for every remaining invalidated slot...
		var slot_k = slotCache[k];
		var new_tile_ind = slot_k.group_history.slice(-1)[0];
		var old_tile_ind = T.cutSlotToTileMapping[k];
		if(isNum(old_tile_ind) && old_tile_ind != new_tile_ind){
			// We already had a tile for this slot, now there is either a new immutable for the slot or the group on the existing immutable has changed.
			// In both cases we need to move the tile
			
			displaced_tiles[new_tile_ind] = T.tiles[new_tile_ind];  //store the destination group for potential use in a subsequent iteration of k-loop
			var movingTile;
			if(!displaced_tiles[old_tile_ind] ){ 
				//source group has not yet been displaced, need to create a placeholder
				movingTile = T.tiles[old_tile_ind];
				var oldTilePlaceholder = T.tiles[old_tile_ind] = T.CreateTile(old_tile_ind); // create and then insert a new tile to fill in the gap we are creating
				movingTile.$.before(oldTilePlaceholder.$); //add the placeholder 
				oldTilePlaceholder.$.hide(); //had to add it to the DOM before hidding in order to for css to get applied and thus alow jQuery to know what display value should be on show
			}else{
				//source group has already been displaced
				movingTile = displaced_tiles[old_tile_ind];
			}
			T.tiles[new_tile_ind].$.replaceWith(movingTile.$); // make the move 
			T.tiles[new_tile_ind] = movingTile; 
			
		} //else: an immutable has been put in a slot, where previously there wasn't one (don't need to do anything special)

		T.tiles[new_tile_ind].$.show()
							   .toggleClass('shake',false) //TODO: on a merger we may not want to cancel the shake
							  .data("group_num",new_tile_ind)
		T.tiles[new_tile_ind].caption.text("group " + new_tile_ind + " | " + slot_k.inds.length + " waves ");
		
		T.cutSlotToTileMapping[k] = new_tile_ind;
	}


	while(T.tiles.length-1 > maxGroupNum) // if there are too many tiles, delete some (-1 becuase of group 0)
		T.tiles.pop().$.remove();

}

T.ClearAllTiles = function(){
	while(T.tiles.length)
		T.tiles.pop().$.remove();
	T.cutSlotToTileMapping = [];
}


T.DocumentReady = function(){

    T.$filesystem_load_button.click(T.ORG.RecoverFilesFromStorage);
	T.CUT.AddChangeCallback(T.SetGroupDataTiles);
	T.CUT.AddChangeCallback(T.WV.SlotsInvalidated);
	T.CUT.AddChangeCallback(T.RM.SlotsInvalidated);
	T.CUT.AddChangeCallback(T.TC.SlotsInvalidated);
	T.CUT.AddActionCallback(T.CutActionCallback);

	if(localStorage.state){
		T.ORG.SwitchToTet(localStorage.tet || 1);
		T.xFactor = localStorage.xFactor || 2;
		T.yFactor = localStorage.yFactor;
		T.binSizeCm = localStorage.BIN_SIZE_CM || 2.5;
		T.$rm_bin_size.val(T.binSizeCm);
		T.$size_input.val(T.xFactor);
		
		//TODO: load files into T.cut instances

		T.SetDisplayIsOn({chanIsOn: JSON.parse(localStorage.chanIsOn)});
		T.RM.SetCmPerBin(T.binSizeCm);
		if(parseInt(localStorage.FSactive) || localStorage.FSactive=="true") 
			T.ToggleFS();//it starts life in the off state, so this turns it on 

	}else{
		T.SetDisplayIsOn({chanIsOn: [1,1,1,1]});
	}
}

T.ResetAndRefresh = function(){
if (!confirm("Do you really want to clear all data and settings and reload the page?"))
  return;
	window.onbeforeunload = "";
	localStorage.clear();
	location.reload();
	//todo: I don't know if you can clear the filesystem here because it is async and we want to reload the page.
}

T.ShowHelp = function(){
	window.open("https://github.com/d1manson/waveform/wiki","_blank");
}

T.TogglePalette = function(){
	T.paletteMode = T.paletteMode  ? 0: 1;
	T.WV.SetPaletteMode(T.paletteMode*2 - 1);
}

T.RunAutocut = function(){
	var chan = -1;
	for(var i=0;i<4;i++)
		if(T.chanIsOn[i])
			if(chan == -1)
				chan = i;
			else{
				alert("Currently you can only autocut on a single channel. Using channel " + (chan+1) + ".");
				break;
			}
	if(chan == -1){
		alert("Currently you can only autocut on a single channel. Using channel 1.");
		chan = 1;
	}
	T.AC.DoAutoCut(chan+1,T.ORG.GetN(),T.ORG.GetTetBuffer(),T.AutocutFinished);
}

T.AutocutFinished = function(cut,chan){
	T.ORG.SwitchToCut(3,cut);// TODO: send {description: 'autocut subsample on channel-' + chan};
}

T.ToggleFS = function(newState){
	if(T.FS.IsActive()){
		//deactivate
		T.$FSbutton.text("turn on FileAPIs");
		T.FS.Toggle(false,T.ShowFileSystemLoaded);
	}else{
		//activate
		T.$FSbutton.text("turn off FileAPIs");
		T.FS.Toggle(true,T.ShowFileSystemLoaded);
	}
}

//For a jQuery element or an array of jQuery elements it removes an existing "state" attribute or adds "state=closed"
T.ToggleElementState = function(el){
	return function(){
		el = [].concat(el); //force it to be an array
		for(var i=0;i<el.length;i++)if(el[i])
			if(el[i].attr("state"))
				el[i].removeAttr("state"); 
			else 
				el[i].attr("state","closed");
	}
}



T.CutActionCallback = function(cut,info){
	if(info.type == "undo"){
		var $oldAction = T.$action_.pop();
		$oldAction.remove();
		return;
	}
	if (info.type == "empty-actions" || info.type == "no-undo"){
		alert(info.description);
		return
	}

	if (info.type == "load"){
		//remove any existing action elements and then go on to add the new one
		T.$action_ = T.$action_ || [];
		while(T.$action_.length)
			T.$action_.pop().remove(); //remove all action elements from page	
		T.$undo.show();
	}

	var $newAction = $("<div class='action' data-action-num='" + info.num + "'><b>" + info.num + "</b>&nbsp;&nbsp;&nbsp;" + info.description + "</div>");
	T.$action_.push($newAction); //store it in the array
	T.$undo.after($newAction);
}


T.ReorderNCut = function(){
	//reorder the cut based on number of spikes per group

	var groups = []; //we build an array of (ind,len) pairs that we can then sort by <len>.

	var cut = T.ORG.GetCut();
	var G = cut.GetProps().G;
	for(var i=0;i<=G;i++)
		groups.push({ind: i,
					 len: cut.GetGroup(i).length});
	groups.sort(function(a,b){return b.len-a.len;});

	//sorting order is in groups[].ind, now pull the inds out into their own array...
	var inds = [];
	while(groups.length)
		inds.push(groups.shift().ind);

	cut.ReorderAll(inds);
}

T.ReorderACut = function(){
	var chan = -1;
	for(var i=0;i<4;i++)
		if(T.chanIsOn[i])
			if(chan == -1)
				chan = i;
			else{
				alert("Currently you can only reorder-on-amplitude using a single channel, taking channel" + (chan+1) + ".");
				break;
			}
	if(chan == -1){
		alert("Currently you can only reorder-on-amplitude using a single channel, taking channel 1.");
		chan = 1;
	}

	var N = T.ORG.GetN();
	var amps = new Uint8Array(N);	//TODO: cache amplitdues while tetrode is loaded (for all channels)
	var buffer = new Int8Array(T.ORG.GetTetBuffer());
	for (var i=0;i<N;i++){
		var b = buffer.subarray(T.BYTES_PER_SPIKE*i + chan*(50+4) + 4,T.BYTES_PER_SPIKE*i + (chan+1)*54-1);
		amps[i] = M.max(b) - M.min(b);
	}

	var mean_amps = M.accumarray(T.ORG.GetCut().GetAsVector(),amps,"mean");

	//TODO: I think there will be a bug if there are any empty groups beyond the end of the last occupied group, need to do an identity transformation for the end or something

	var groups = []; //we build an array of (ind,amp) pairs that we can then sort by <amp>.
	for(var i=0;i<mean_amps.length;i++)
		groups.push({ind: i,
					 amp: isNaN(i)? 256 : mean_amps[i]});
	groups.sort(function(a,b){return b.amp-a.amp;});

	//sorting order is in groups[].ind, now pull the inds out into their own array...
	var inds = [];
	while(groups.length)
		inds.push(groups.shift().ind);
	T.ORG.GetCut().ReorderAll(inds);
}

T.ShowFileSystemLoaded = function(file_names){
	if(!file_names || file_names.length == 0){
		$('#filestem_caption').html("No files available.");
		T.$filesystem_load_button.hide();
	}else{
		$('#filestem_caption').html("Found " + file_names.length + " existing files.<BR>" + file_names.join("<BR>")); //TODO: using html here with filenames is potentially a bug
		T.$filesystem_load_button.show();
	}
}

T.FilterHeader = function(){
	var str = T.$header_search.val().toLowerCase();
	T.$info_panel.find('tr').each(function(){
			if($(this).text().toLowerCase().search(str)==-1)
				$(this).hide();
			else
				$(this).show()
			})
}

T.UndoLastAction = function(){
	T.ORG.GetCut().Undo();
}

$('.help_button').each(function(){$(this).click(T.ShowHelp);});
$('#apply_size').click(T.ApplySizeClick);
T.$size_input = $('#size_input');
T.$tilewall = $('.tilewall');
T.$posplot = $('#posplot');
T.$action_panel = $('#action_panel');
T.tiles = [];
T.$drop_zone = $('.file_drop');				 			 
T.$info_panel = $('#info_panel');
$('#reorder_n_button').click(T.ReorderNCut);
$('#reorder_A_button').click(T.ReorderACut);
T.$undo = $('.undo').click(T.UndoLastAction);
$('.bar').click(T.ToggleElementState([$('.bar'),$('.side_panel'),T.$tilewall]));
T.$FSbutton = $('#filesystem_button').click(T.ToggleFS);
$('#spatial_panel_toggle').click(T.ToggleElementState($('#spatial_panel')));
$('#action_panel_toggle').click(T.ToggleElementState(T.$action_panel));
$('#button_panel_toggle').click(T.ToggleElementState($('#button_panel')));
T.$files_panel = $('#files_panel');
$('#files_panel_toggle').click(T.ToggleElementState(T.$files_panel));
$('#reset_button').click(T.ResetAndRefresh);
T.$chanButton_ = $("input[name=channel]:checkbox").click(T.DisplayIsOnClick);
$('#toggle_palette').click(T.TogglePalette);
$('#autocut').click(T.RunAutocut);
T.$rm_bin_size = $('#rm_bin_size');
$('#apply_rm_size').click(T.ApplyRmSizeClick);
T.$file_info = [$('#tet_info'),$('#cut_info'),$('#pos_info'),$('#set_info')];
T.$filesystem_load_button = $('#filesystem_load_button');
T.$header_search = $('#header_search');
T.$header_search.on(T.$header_search.get(0).onsearch === undefined ? "input" : "search",T.FilterHeader);

// KEYBOARD SHORTCUTS from keymaster  (github.com/madrobby/keymaster)
key('p',T.TogglePalette);
key('a',T.RunAutocut);
key('ctrl+z',T.UndoLastAction);
key('esc',T.ToggleElementState([$('.bar'),$('.side_panel'),T.$tilewall]));
key('1, shift+1',function(){T.DisplayIsOnClick(null,{val:T.DISPLAY_ISON.CHAN[0],shiftKey:key.shift});});
key('2, shift+2',function(){T.DisplayIsOnClick(null,{val:T.DISPLAY_ISON.CHAN[1],shiftKey:key.shift});});
key('3, shift+3',function(){T.DisplayIsOnClick(null,{val:T.DISPLAY_ISON.CHAN[2],shiftKey:key.shift});});
key('4, shift+4',function(){T.DisplayIsOnClick(null,{val:T.DISPLAY_ISON.CHAN[3],shiftKey:key.shift});});
key('r, shift+r',function(){T.DisplayIsOnClick(null,{val:T.DISPLAY_ISON.RM[0],shiftKey:key.shift});});
key('t, shift+t',function(){T.DisplayIsOnClick(null,{val:T.DISPLAY_ISON.TC,shiftKey:key.shift});});

if(!(window.requestFileSystem || window.webkitRequestFileSystem))
	$('#filesystem_button').hide();

$(document).bind("contextmenu",function(e){return false;})
		    .ready(T.DocumentReady);
window.onbeforeunload = T.StoreData;
