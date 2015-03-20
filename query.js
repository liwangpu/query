(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.Query = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/**
 * Mongo-like queries in Javascript.
 *
 * This project was developed independently of underscore-query as a proprietary module, yet is remarkably similar.  
 * Specifically it passes the great majority of unit tests in the underscore-query module, which are borrowed here.  So have made a few changes to make them as compatible as possible.
 *
 * It does some things differently than underscore-query:
 *    - uses `==` rather than `===` as the  $eq comparator, so it works with CSV data where `"3"` may not have been cast to `3`
 *    - $and and $or constraints specified as linear arrays of constraint objects, rather than associative arrays
 *    - Recursive application of $and and $or, such that these can be used on the left or right hand side of constraints
 *    - Optional application of dot parsing attributes for speed in large datasets
 *    - Support for $where clauses
 *
 * It does not (yet?) do some cool things underscore-query does:
 *    - Chaining to build query objects
 *    - Scoring
 *    - Pass model in as `this` on $cb (here, use the $where clause for that)
 *    - Support for `$computed` (here use the `$where` clause for this)
 */


// Support  CommonJS, AMD or independent user
//http://stackoverflow.com/questions/13673346/supporting-both-commonjs-and-amd
(function (name, definition) {
  if (typeof module != 'undefined') module.exports = definition();
  else if (typeof define == 'function' && typeof define.amd == 'object') define(definition);
  else this[name] = definition();
}('Logic', function () {
  //This is the code you would normally have inside define() or add to module.exports

  function objectify(a) {
    var rows = [];
    for (var key in a) {
      var o = {};
      o[key] = a[key];
      rows.push(o);
    }
    return rows;
  }



  // polyfill, since String.startsWith is part of ECMAScript 6,
  if (!String.prototype.startsWith) {
    Object.defineProperty(String.prototype, 'startsWith', {
      enumerable: false,
      configurable: false,
      writable: false,
      value: function (searchString, position) {
        position = position || 0;
        return this.lastIndexOf(searchString, position) === position;
      }
    });
  }

  // polyfill, since String.endsWith is part of ECMAScript 6,
  if (!String.prototype.endsWith) {
    Object.defineProperty(String.prototype, 'endsWith', {
      value: function (searchString, position) {
        var subjectString = this.toString();
        if (position === undefined || position > subjectString.length) {
          position = subjectString.length;
        }
        position -= searchString.length;
        var lastIndex = subjectString.indexOf(searchString, position);
        return lastIndex !== -1 && lastIndex === position;
      }
    });
  }



  var Logic = {

    Query: function (constraints, getter) {
      return function (row) {
        return Logic.lhs._rowsatisfies(row, constraints, getter);
      }
    },

    query: function (rows, constraints, getter) {

      if (typeof getter == 'string') {
        var method = getter;

        getter = function (obj, key) {
          return obj[method](key);
        };
      }
      var filter = new Logic.Query(constraints, getter);
      return rows.filter(filter);
    },


    lhs: { // queries that are not yet referenced to a particular attribute, e.g. {$not: {likes: 0}}

      // test whether a row satisfies a constraints hash,
      _rowsatisfies: function (row, constraints, getter) {
        for (var key in constraints) {
          if (this[key]) {
            if (!this[key](row, constraints[key], getter)) return false;
          }
          else {
            var val = (getter ? getter(row, key) : row[key]);
            if (!this.rhs._satisfies(val, constraints[key], key)) return false;
          }
        }
        return true;
      },


      $not: function (row, constraint, getter) {
        return !this._rowsatisfies(row, constraint, getter);
      },

      $or: function (row, constraint, getter) {
        if (!Array.isArray(constraint)) {
          constraint = objectify(constraint);
        }
        for (var i = 0; i < constraint.length; i++) {
          if (this._rowsatisfies(row, constraint[i], getter)) return true;
        }
        return false;
      },

      $and: function (row, constraint, getter) {
        if (!Array.isArray(constraint)) {
          constraint = objectify(constraint);
        }

        for (var i = 0; i < constraint.length; i++) {
          if (!this._rowsatisfies(row, constraint[i], getter)) return false;
        }
        return true;
      },

      $nor: function (row, constraint, getter) {
        return !this.$or(row, constraint, getter)
      },

      $where: function (values, ref) {
        var fn = (typeof ref == 'string') ? new Function(ref) : ref;
        var res = fn.call(values)
        return res;
      },



    rhs: {  // queries that reference a particular attribute, e.g. {likes: {$gt: 10}}

      $cb: function (value, constraint, parentKey) {
        return constraint(value)
      },
      // test whether a single value matches a particular constraint
      _satisfies: function (value, constraint, parentKey) {

        if (constraint == value) {
          return true;
        }
        else if (constraint instanceof RegExp) {
          return this.$regex(value, constraint);
        }
        else if (typeof constraint === 'object') {

          for (var key in constraint) {
            if (!this[key]) {
              return this.$eq(value, constraint, parentKey)
              throw new Error("Constraint function not recognized: " + key);
            }
            if (!this[key](value, constraint[key], parentKey)) {
              return false;
            }
          }
          return true;
        }
        else if (constraint === '' || constraint == null || constraint === undefined) {
          return this.$null(value);
        }
        else {
          return this.$eq(value, constraint);
        }
      },

      $exists: function (value, constraint, parentKey) {
        return (value != undefined) == (constraint && true);
      },

      $eq: function (value, constraint) {
        if (Array.isArray(value)) {
          for (var i = 0; i < value.length; i++) {
            if (this.$eq(value[i], constraint)) {
              return true;
            }
          }
          return false;
        }

        return value == constraint;
      },

      $deepEquals: function (value, constraint) {
        if (typeof _ == 'undefined' || typeof _.isEqual == 'undefined') {
          return JSON.stringify(value) == JSON.stringify(constraint); //
        }
        else {
          return _.isEqual(value, constraint);
        }

      },

      $not: function (values, constraint) {
        return !this._satisfies(values, constraint);

      },

      $ne: function (values, constraint) {
        return !this._satisfies(values, constraint);
      },

      $nor: function (values, constraint, parentKey) {
        return !this.$or(values, constraint, parentKey);
      },

      $and: function (values, constraint, parentKey) {

        if (!Array.isArray(constraint)) {
          throw new Error("Logic $and takes array of constraint objects");
        }
        for (var i = 0; i < constraint.length; i++) {
          var res = this._satisfies(values, constraint[i], parentKey);
          if (!res) return false;
        }
        return true;
      },

      // Identical to $in, but allows for different semantics
      $or: function (values, constraint, parentKey) {

        if (!Array.isArray(values)) {
          values = [values];
        }

        for (var v = 0; v < values.length; v++) {
          for (var i = 0; i < constraint.length; i++) {
            if (this._satisfies(values[v], constraint[i], parentKey)) {
              return true;
            }
          }
        }

        return false;
      },

      /**
       * returns true if all of the values in the array are null
       * @param values
       * @returns {boolean}
       */
      $null: function (values) {
        if (values === '' || values === null || values === undefined) {
          return true;
        }
        else if (Array.isArray(values)) {
          for (var v = 0; v < values.length; v++) {
            if (!(values[v] === '' || values[v] === null || values === undefined)) {
              return false;
            }
          }
          return true;
        }
        else return false;
      },


      /**
       * returns true if any of the values are keys of the constraint
       * @param values
       * @param constraint
       * @returns {boolean}
       */
      $in: function (values, constraint) {
        if (!Array.isArray(constraint)) throw new Error("$in requires an array operand");
        var result = false;
        if (!Array.isArray(values)) {
          values = [values];
        }
        for (var v = 0; v < values.length; v++) {
          var val = values[v];
          for (var i = 0; i < constraint.length; i++) {
            if (this._satisfies(val, constraint[i])) {
              result = true;
              break;
            }
          }
          result = result || ( constraint.indexOf(val) >= 0);
        }

        return result;
      },

      $likeI: function (values, constraint) {
        return values.toLowerCase().indexOf(constraint) >= 0;
      },

      $like: function (values, constraint) {
        return values.indexOf(constraint) >= 0;
      },

      $startsWith: function (values, constraint) {
        if (!values) return false;
        return values.startsWith(constraint);
      },

      $endsWith: function (values, constraint) {
        if (!values) return false;
        return values.endsWith(constraint);
      },

      $elemMatch: function (values, constraint, parentKey) {
        for (var i = 0; i < values.length; i++) {
          if (Logic.lhs._rowsatisfies(values[i], constraint)) return true;
        }
        return false;
      },

      $contains: function (values, constraint) {
        return values.indexOf(constraint) >= 0;
      },

      $nin: function (values, constraint) {
        return !this.$in(values, constraint);
      },

      $regex: function (values, constraint) {
        var result = false;
        if (Array.isArray(values)) {
          for (var i = 0; i < values.length; i++) {
            if (constraint.test(values)) {
              result = true;
              break;
            }
          }
        }
        else return constraint.test(values);
      },

      $gte: function (values, ref) {
        return values >= ref;
      },

      $gt: function (values, ref) {
        return values > ref;
      },

      $lt: function (values, ref) {
        return values < ref;
      },

      $lte: function (values, ref) {
        return values <= ref;
      },

      $type: function (values, ref) {
        return typeof values == ref;
      },

      $all: function (values, ref) {
        throw new Error("$all not implemented")
      },

      $size: function (values, ref) {
        return (typeof values == 'object' && (values.length == ref || Object.keys(values).length == ref) );
      },

      $mod: function (values, ref) {
        return values % ref[0] == ref[1]
      },
      $equal: function () {
        return this.$eq(arguments);
      },
      $between: function (values, ref) {
        return this._satisfies(values, {$gt: ref[0], $lt: ref[1]})
      }
    }
    }
  };

  // Provide means to parse dot notation for deep Mongo queries, optional for performance
  Logic.undot = function (obj, key) {
    var keys = key.split('.'), sub = obj;
    for (var i = 0; i < keys.length; i++) {
      sub = sub[keys[i]]
    }
    return sub;
  };

  Logic.lhs.rhs.$equal = Logic.lhs.rhs.$eq;
  Logic.lhs.rhs.$any = Logic.lhs.rhs.$or;
  Logic.lhs.rhs.$all = Logic.lhs.rhs.$and;

  if (exports && (typeof module !== "undefined" && module !== null ? module.exports : void 0)) {
    return module.exports = Logic;
  }

  //This allows a query object with regex values to be serialized to JSON
  //http://stackoverflow.com/questions/12075927/serialization-of-regexp
  //However, it doesn't solve the problem of parsing them back to regex on input
  RegExp.prototype.toJSON = RegExp.prototype.toString;

  return Logic;

}));

},{}]},{},[1])(1)
});