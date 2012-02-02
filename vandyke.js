/*
 VanDyke -- an obvious rewrite of Mustache
 Originally based on: http://github.com/defunkt/mustache and http://github.com/janl/mustache

 original authors:
        Chris Wanstrath chris@wanstrath.com,
        Jan Lehnardt <jan@apache.org>,
				Alexander Lang <alex@upstream-berlin.com>,
				Sebastian Cohnen <sebastian.cohnen@googlemail.com>

  this implementation by Raul Miller <rauldmiller@gmail.com>

  Thanks @defunkt for the awesome code.

  See http://github.com/defunkt/mustache for more info.

  See http://r-nd-m.blogspot.com/2012/01/mustachejs.html for some issues leading to re-implementation and perhaps temporary rename
	Generally speaking: the motivations here are similar to the motivations behind the v1.1.2 mustache spec
	However, I have introduced another abstraction layer, so that data may be presented as data structures (e.g. JSON) or as jQuery selectors (e.g. XML)
	this means that a part of the spec gets moved to the data abstraction layer, and is factored out of the TEMPLATE engine

	also, I do not like https://github.com/mustache/spec/blob/master/specs/delimiters.yml "Standalone Line Endings" and https://github.com/mustache/spec/blob/master/specs/inverted.yml "Standalone Lines" where text surrounding the substituted part of the TEMPLATE gets modified -- I feel that that violates the modularity of the system, and it's unnecessary for the usual case (where the TEMPLATE is used to generate HTML). 

	I have deliberately omitted support for indistinguishable nested section.  For example:
	https://github.com/mustache/spec/blob/master/specs/inverted.yml "Nested (Falsey)" and "Nested (Truthy)"
	Treating those as {{A}}x{{A}}y{{/A}}z{{/A}} nested creates an ambiguity in the parser which causes scope problems in more complicated TEMPLATEs.
	This kind of nesting is totally unnecessary for truthy/falsey substitutions.  Data structures can be constructed which could encourage this kind of nesting for nested sections, but there are no tests in https://github.com/mustache/spec/blob/master/specs/interpolation.yml or https://github.com/mustache/spec/blob/master/specs/sections.yml which ask nesting where the same name is used at distinct levels of a structure hierarchy.

	Finally, I disagree with https://github.com/mustache/spec/blob/master/specs/~lambdas.yml.  I believe that data selection from data structures should be implemented using lambdas.  The details of the data selection depends on the details of the lambda.  Thus, the interpretation of a.b.c would be delegated to the lambda -- if the lambda was handling a regular data structure, this would select data element a, and inside of that select data element b and inside that select data element c.  if the lambda used jQuery selectors to access the data, then a.b.c would be the result of using a.b.c as a jquery selector in the current CONTEXT stack (returning the first non-empty result, or returning an empty result).

	That said, this concept for lambdas leave us with an ambiguity -- we need to distinguish between a data structure and a string.  To resolve this: the lambda should always return a data structure.  Van Dyke needs to be given a routine that converts from data structure to string.  In this initial revision, only one such routine is supported.


*/

// needed for bootstrapping, so outside the object

var VanDyke = function() {
	var Renderer = function(TEMPLATE, View, PARTIALS, emit) {
		this.TEMPLATE= TEMPLATE || '';
		this.CONTEXT= this.push_context(View);
		this.PARTIALS= PARTIALS || {};
		if (emit) this.emit= emit;
		this.BUFFER= [];
	};

  Renderer.prototype = {
		  CONTEXT: null
		, START: 0
		, OPEN: '{{'
		, CLOSE: '}}'

		, re_quote: function(TXT) {
			return TXT.replace(/(\W)/g, '\\$1').replace(/\\ /g, '\\s+');
		}

		, set_TAG_RE: function() {
			this.TAG_RE= new RegExp(this.re_quote(this.OPEN)+'\\s*([\\s\\S]*?)\\s*'+this.re_quote(this.CLOSE), 'g');
			this.FUDGELEN= this.CLOSE.length;
		}

		, trim_optional_trailing: function(TAG, TAIL) {
			var FIX1= TAIL == TAG.substr(-1);
			if (FIX1) return this.deb(TAG.substring(1,TAG.length - 1));
			if (TAIL && (TAIL+this.CLOSE) == this.TEMPLATE.substr(this.START-this.FUDGELEN, 1+this.FUDGELEN))
				this.START++;
			return this.deb(TAG.substring(1));
		}

		, gen_END_RE: function(TAG) {
			var REGEXP= new RegExp(this.re_quote(this.OPEN)+'\\s*\\/\\s*'+this.re_quote(TAG)+'\\s*'+this.re_quote(this.CLOSE), 'g');
			REGEXP.lastIndex= this.START;
			return REGEXP;
		}

		, deb: function(TXT) { /* delete extra blanks */
			return TXT.replace(/^\s+/, '').replace(/\s+$/, '').replace(/\s+/g, ' ');
		}

		, emit: function(CONTENT) {
			this.BUFFER.push(CONTENT);
		}

		, get_next_match: function(RE) {
			this.PREVIOUS= this.START;
			RE.lastIndex= this.START;
			var MATCH= RE.exec(this.TEMPLATE);
			if (MATCH && RE.lastIndex <= this.END) {
				this.START= RE.lastIndex;
				return MATCH;
			}
			RE.lastIndex= 0;
			return null;
		}

    , do_render: function() {
			this.set_TAG_RE();
			var MATCH;
			if (!this.END) this.END= this.TEMPLATE.length;
			while (MATCH= this.get_next_match(this.TAG_RE)) {
				var TAG= MATCH[1];
				this.emit(this.TEMPLATE.substring(this.PREVIOUS, MATCH.index));
				var CLEAN_TAG;
				switch (TAG.substring(0,1)) {
				 	case '/': /* bogus close tag */
				 	case '!': /* comment */
						continue;
					case '=': /* new delimiters */
						CLEAN_TAG= this.trim_optional_trailing(TAG, '=');
						this.render_delimiters(CLEAN_TAG);
						continue;
					case '>': /* partial */
						CLEAN_TAG= this.trim_optional_trailing(TAG);
						this.render_partial(CLEAN_TAG);
						continue;
					case '?': /* section */
						CLEAN_TAG= this.trim_optional_trailing(TAG);
						this.render_boolean_section(CLEAN_TAG);
						continue;
					case '#': /* section */
						CLEAN_TAG= this.trim_optional_trailing(TAG);
						this.render_section(CLEAN_TAG);
						continue;
					case '^': /* inverted section */
						CLEAN_TAG= this.trim_optional_trailing(TAG);
						this.render_inverted_boolean_section(CLEAN_TAG);
						continue;
					case '{': /* unquoted */
						CLEAN_TAG= this.trim_optional_trailing(TAG, '}');
						this.render_value(CLEAN_TAG, 0);
						continue;
					case '&': /* unquoted */
						CLEAN_TAG= this.trim_optional_trailing(TAG);
						this.render_value(CLEAN_TAG, 0);
						continue;
					default: /* quoted */
						CLEAN_TAG= this.deb(TAG);
						this.render_value(CLEAN_TAG, 1)
						continue;
				}
			}
			this.emit(this.TEMPLATE.substring(this.START, this.END));
			this.START= this.END;
		}

    , sub_renderer: function(CONTEXT) {
			var THAT= this;
			var RENDERER= new Renderer();
			RENDERER.OPEN= this.OPEN;
			RENDERER.CLOSE= this.CLOSE;
			RENDERER.START= this.START;
			RENDERER.END= this.END;
			RENDERER.TEMPLATE= this.TEMPLATE;
			RENDERER.PARTIALS= this.PARTIALS;
			RENDERER.emit= function(txt) {THAT.emit(txt)};
			RENDERER.CONTEXT= CONTEXT;
			return RENDERER;
		}

		, view_has_content: function(VIEW) {
			if (!VIEW) return VIEW;
			var typ= typeof VIEW;
			if ('string' == typ) return VIEW;
			if (0 != VIEW.length) return VIEW;
			return '';
		}

		, push_context: function(NewView) {
			if (!this.view_has_content(NewView)) return this.CONTEXT;
			return {
				VIEW: NewView,
				PREV: this.CONTEXT
			};
		}

		, render_delimiters: function(DELIMITERS) {
			var PAIR= DELIMITERS.split(' ');
			if (2 != PAIR.length) return;  /* invalid delimiter pair */
			var RENDERER= this.sub_renderer(this.CONTEXT);
			RENDERER.OPEN= PAIR[0];
			RENDERER.CLOSE= PAIR[1];
			var END_RE= this.gen_END_RE(DELIMITERS);
			var MATCH= this.get_next_match(END_RE);
			if (MATCH) { /* do we have a valid closing delimiter? */
				RENDERER.END= MATCH.index;
				RENDERER.do_render();
		    this.START= END_RE.lastIndex;
			} else { /* no closing delimiter -- render until we hit the end of the document */
				RENDERER.do_render();
				this.START= RENDERER.START;
			}
		}

		, render_partial: function(PARTIAL_NAME) {
			var PARTIAL= this.PARTIALS[PARTIAL_NAME];
			var t= ''; for (var p in this.PARTIALS) {t=t+p+' '}
			if (!PARTIAL) return; /* if no such partial, it's equivalent to a blank template */
			var NewView= this.find_in_context(PARTIAL_NAME);
			var RENDERER= this.sub_renderer(NewView ?this.push_context(NewView) :this.CONTEXT);
			RENDERER.TEMPLATE= PARTIAL;
			RENDERER.OPEN= '{{';
			RENDERER.CLOSE= '}}';
			RENDERER.START= 0;
			RENDERER.END= PARTIAL.length;
			RENDERER.do_render();
		}

		, render_section: function(SECTION_ID) {
			var END_RE= this.gen_END_RE(SECTION_ID);
			var MATCH= END_RE.exec(this.TEMPLATE);
			var CONTINUE= MATCH ?END_RE.lastIndex :this.END;
			var VIEW= this.find_in_context(SECTION_ID);
			if (this.view_has_content(VIEW)) {
				var START= this.START;
				var END= (MATCH || {index: this.END}).index;
				var COUNT= VIEW.length || 1;
				var get_instance= VIEW.length ?function(){return VIEW[J]} :function(){return VIEW};
				var J= 0;
				var RENDERER= this.sub_renderer(this.push_context(get_instance()));
				while (true) {
			  	RENDERER.END= END;
					RENDERER.do_render();
					if (++J >= COUNT) break;
					RENDERER.START= START;
					RENDERER.CONTEXT= this.push_context(get_instance());
				}
			}
			this.START= CONTINUE;
		}

		/* FIXME: do not need another renderer here */
		, render_boolean_section: function(SECTION_ID) {
			var END_RE= this.gen_END_RE(SECTION_ID);
			var MATCH= END_RE.exec(this.TEMPLATE);
			var CONTINUE= MATCH ?END_RE.lastIndex :this.END;
			var VIEW= this.find_in_context(SECTION_ID);
			if (this.view_has_content(VIEW)) {
				var START= this.START;
				var END= (MATCH || {index: this.END}).index;
				var COUNT= VIEW.length || 1;
				var RENDERER= this.sub_renderer(this.push_context(VIEW));
			  	RENDERER.END= END;
				RENDERER.do_render();
			}
			this.START= CONTINUE;
		}

		, render_inverted_boolean_section: function(SECTION_ID) {
			var END= this.END;
			var END_RE= this.gen_END_RE(SECTION_ID);
			var MATCH= END_RE.exec(this.TEMPLATE);
			var CONTINUE= MATCH ?END_RE.lastIndex :this.END;
			var VIEW= this.find_in_context(SECTION_ID);
			if (!this.view_has_content(VIEW)) {
				this.END= MATCH.index;
				this.do_render();
				this.END= END;
			}
			this.START= CONTINUE;
		}

		, render_value: function(SELECTOR, QUOTE) {
			var value= this.find_in_context(SELECTOR);
			var TextVal= value.to_s || value.to_string || value;
			var TEXT= '';
			/* if (TextVal) */
				if ('function' == typeof TextVal) 
					TEXT= TextVal();
				else
					TEXT= TextVal;
			this.emit(QUOTE ?this.html_quote(TEXT) :TEXT);
		}

		, find_in_context: function(TAG) {
			for (var C= this.CONTEXT; C; C= C.PREV) {
				var VIEW= TAG ?this.lookup(C.VIEW, TAG) :C.VIEW;
				if (VIEW && 0 != VIEW.length) return VIEW;
			}
			return '';
		}

		, lookup: function(View, TAG) {
			if ('function' == typeof View) return View(TAG);
			var TAGS= TAG.split('.');
			for (var J= 0; J < TAGS.length; J++) {
				if (TAGS[J]) View= View[TAGS[J]];
				if (!View) return View;
			}
			return View;
		}

		, html_quote: function(TEXT) {
			return ((TEXT ||'')+'').replace(/[&"<>]/g, function(CHAR) {
				switch (CHAR) {
          case '&': return '&amp;';
          case '"': return '&quot;';
          case '<': return '&lt;';
          case '>': return '&gt;';
				}
      });
    }
	};

  return({
		name: "vandyke.js", /* derived from mustachejs */
    version: "0.2.4-rdm",

    /*
     * Turns a View with a TEMPLATE into HTML (or, sometimes into something other than HTML)
     */
    to_html: function(TEMPLATE, View, PARTIALS, emit) {
      var renderer = new Renderer(TEMPLATE, View, PARTIALS, emit);
      renderer.do_render();
      return renderer.BUFFER.join('');
    }
  });
}();
