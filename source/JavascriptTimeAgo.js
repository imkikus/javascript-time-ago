import RelativeTimeFormat from 'relative-time-format'

import Cache from './cache'
import grade from './grade'
import chooseLocale from './locale'

import {
	addLocaleData,
	getLocaleData
} from './LocaleDataStore'

// For historical reasons, "approximate" is the default style.
import defaultStyle from './style/approximate'
import getStyleByName from './style/getStyleByName'

// const EXTRA_STYLES = [
// 	'long-time',
// 	'short-time',
// 	'mini-time'
// ]

// Valid time units.
const UNITS = [
	'now',
	// The rest are the same as in `Intl.RelativeTimeFormat`.
	'second',
	'minute',
	'hour',
	'day',
	'week',
	'month',
	'quarter',
	'year'
]

export default class JavascriptTimeAgo
{
	/**
	 * @param {(string|string[])} locales=[] - Preferred locales (or locale).
	 */
	constructor(locales = [])
	{
		// Convert `locales` to an array.
		if (typeof locales === 'string') {
			locales = [locales]
		}

		// Choose the most appropriate locale
		// (one of the previously added ones)
		// based on the list of preferred `locales` supplied by the user.
		this.locale = chooseLocale(
			locales.concat(RelativeTimeFormat.getDefaultLocale()),
			getLocaleData
		)

		// Use `Intl.NumberFormat` for formatting numbers (when available).
		if (typeof Intl !== 'undefined' && Intl.NumberFormat) {
			this.numberFormat = new Intl.NumberFormat(this.locale)
		}

		// Cache `Intl.RelativeTimeFormat` instance.
		this.relativeTimeFormatCache = new Cache()
	}

	// Formats the relative date/time.
	//
	// @return {string} Returns the formatted relative date/time.
	//
	// @param {(Object|string)} [style] - Relative date/time formatting style.
	//
	// @param {string[]} [style.units] - A list of allowed time units
	//                                  (e.g. ['second', 'minute', 'hour', …])
	//
	// @param {Function} [style.custom] - `function ({ elapsed, time, date, now })`.
	//                                    If this function returns a value, then
	//                                    the `.format()` call will return that value.
	//                                    Otherwise it has no effect.
	//
	// @param {string} [style.flavour] - e.g. "long", "short", "mini-time", etc.
	//
	// @param {Object[]} [style.gradation] - Time scale gradation steps.
	//
	// @param {string} style.gradation[].unit - Time interval measurement unit.
	//                                          (e.g. ['second', 'minute', 'hour', …])
	//
	// @param {Number} style.gradation[].factor - Time interval measurement unit factor.
	//                                            (e.g. `60` for 'minute')
	//
	// @param {Number} [style.gradation[].granularity] - A step for the unit's "amount" value.
	//                                                   (e.g. `5` for '0 minutes', '5 minutes', etc)
	//
	// @param {Number} [style.gradation[].threshold] - Time interval measurement unit threshold.
	//                                                 (e.g. `45` seconds for 'minute').
	//                                                 There can also be specific `threshold_[unit]`
	//                                                 thresholds for fine-tuning.
	//
	// @param  {boolean} [options.future] — Tells how to format value `0`: as "future" (`true`) or "past" (`false`). Is `false` by default, but should have been `true` actually.
	//
	format(input, style = defaultStyle, options = {}) {
		if (typeof style === 'string') {
			style = getStyleByName(style)
		}

		const { date, time } = getDateAndTimeBeingFormatted(input)

		// Get locale messages for this formatting flavour
		const { flavour, localeData } = this.getLocaleData(style.flavour)

		// Can pass a custom `now`, e.g. for testing purposes.
		// Technically it doesn't belong to `style`
		// but since this is an undocumented internal feature,
		// taking it from the `style` argument will do (for now).
		const now = style.now || Date.now()

		// how much time elapsed (in seconds)
		const elapsed = (now - time) / 1000 // in seconds

		const _getNowMessage = () => {
			return getNowMessage(
				options.future || elapsed < 0,
				localeData,
				getLocaleData(this.locale).long,
				getLocaleData(this.locale).now
			)
		}

		// `custom` – A function of `{ elapsed, time, date, now, locale }`.
		// If this function returns a value, then the `.format()` call will return that value.
		// Otherwise the relative date/time is formatted as usual.
		// This feature is currently not used anywhere and is here
		// just for providing the ultimate customization point
		// in case anyone would ever need that. Prefer using
		// `gradation[step].format(value, locale)` instead.
		//
		// I guess `custom` is deprecated and will be removed
		// in some future major version release.
		//
		if (style.custom) {
			const custom = style.custom({
				now,
				date,
				time,
				elapsed,
				locale: this.locale
			})
			if (custom !== undefined) {
				return custom
			}
		}

		// Available time interval measurement units.
		const units = getTimeIntervalMeasurementUnits(
			style.units,
			localeData,
			_getNowMessage
		)

		// If no available time unit is suitable, just output an empty string.
		if (units.length === 0) {
			console.error(`Units "${units.join(', ')}" were not found in locale data for "${this.locale}".`)
			return ''
		}

		// Choose the appropriate time measurement unit
		// and get the corresponding rounded time amount.
		const step = grade(
			elapsed,
			now,
			units,
			style.gradation
		)

		// If no time unit is suitable, just output an empty string.
		// E.g. when "now" unit is not available
		// and "second" has a threshold of `0.5`
		// (e.g. the "canonical" grading scale).
		if (!step) {
			return ''
		}

		if (step.format) {
			return step.format(date || time, this.locale)
		}

		const { unit, factor, granularity } = step

		let amount = Math.abs(elapsed) / factor

		// Apply granularity to the time amount
		// (and fallback to the previous step
		//  if the first level of granularity
		//  isn't met by this amount)
		if (granularity) {
			// Recalculate the elapsed time amount based on granularity
			amount = Math.round(amount / granularity) * granularity
		}

		// `Intl.RelativeTimeFormat` doesn't operate in "now" units.
		if (unit === 'now') {
			return _getNowMessage()
		}

		switch (flavour) {
			case 'long':
			case 'short':
			case 'narrow':
				// By default, zero is formatted in "past" mode,
				// unless `future: true` option is passed.
				// `relative-time-format@0.1.x` doesn't differentiate between `0` and `-0`,
				// so it won't format `0` values in "future" mode.
				// Format `value` using `Intl.RelativeTimeFormat`.
				return this.getFormatter(flavour).format(-1 * Math.sign(elapsed) * Math.round(amount), unit)
			default:
				// Format `value`.
				// (mimicks `Intl.RelativeTimeFormat` with the addition of extra styles)
				return this.formatValue(-1 * Math.sign(elapsed) * Math.round(amount), unit, localeData, {
					future: options.future
				})
		}
	}

	/**
	 * Mimicks what `Intl.RelativeTimeFormat` does for additional locale styles.
	 * @param  {number} value
	 * @param  {string} unit
	 * @param  {object} localeData — Relative time messages for the flavor.
	 * @param  {boolean} [options.future] — Tells how to format value `0`: as "future" (`true`) or "past" (`false`). Is `false` by default, but should have been `true` actually.
	 * @return {string}
	 */
	formatValue(value, unit, localeData, { future }) {
		return this.getRule(value, unit, localeData, { future }).replace('{0}', this.formatNumber(Math.abs(value)))
	}

	/**
	 * Returns formatting rule for `value` in `units` (either in past or in future).
	 * @param {number} value - Time interval value.
	 * @param {string} unit - Time interval measurement unit.
	 * @param  {object} localeData — Relative time messages for the flavor.
	 * @param  {boolean} [options.future] — Tells how to format value `0`: as "future" (`true`) or "past" (`false`). Is `false` by default, but should have been `true` actually.
	 * @return {string}
	 * @example
	 * // Returns "{0} days ago"
	 * getRule(-2, "day")
	 */
	getRule(value, unit, localeData, { future }) {
		const unitRules = localeData[unit]
		// Bundle size optimization technique.
		if (typeof unitRules === 'string') {
			return unitRules
		}
		// Choose either "past" or "future" based on time `value` sign.
		// If "past" is same as "future" then they're stored as "other".
		// If there's only "other" then it's being collapsed.
		const pastOrFuture = value === 0 ? (future ? 'future' : 'past') : (value < 0 ? 'past' : 'future')
		const quantifierRules = unitRules[pastOrFuture] || unitRules
		// Bundle size optimization technique.
		if (typeof quantifierRules === 'string') {
			return quantifierRules
		}
		// Quantify `value`.
		const quantify = getLocaleData(this.locale).quantify
		let quantifier = quantify && quantify(Math.abs(value))
		// There seems to be no such locale in CLDR
		// for which `quantify` is missing
		// and still `past` and `future` messages
		// contain something other than "other".
		/* istanbul ignore next */
		quantifier = quantifier || 'other'
		// "other" rule is supposed to always be present.
		// If only "other" rule is present then "rules" is not an object and is a string.
		return quantifierRules[quantifier] || quantifierRules.other
	}

	/**
	 * Formats a number into a string.
	 * Uses `Intl.NumberFormat` when available.
	 * @param  {number} number
	 * @return {string}
	 */
	formatNumber(number) {
		return this.numberFormat ? this.numberFormat.format(number) : String(number)
	}

	/**
	 * Returns an `Intl.RelativeTimeFormat` for a given `flavor`.
	 * @param {string} flavor
	 * @return {object} `Intl.RelativeTimeFormat` instance
	 */
	getFormatter(flavor) {
		// `Intl.RelativeTimeFormat` instance creation is assumed a
		// lengthy operation so the instances are cached and reused.
		return this.relativeTimeFormatCache.get(this.locale, flavor) ||
			this.relativeTimeFormatCache.put(this.locale, flavor, new RelativeTimeFormat(this.locale, { style: flavor }))
	}

	/**
	 * Gets locale messages for this formatting flavour
	 *
	 * @param {(string|string[])} flavour - Relative date/time formatting flavour.
	 *                                      If it's an array then all flavours are tried in order.
	 *
	 * @returns {Object} Returns an object of shape { flavour, localeData }
	 */
	getLocaleData(flavour = []) {
		// Get relative time formatting rules for this locale
		const localeData = getLocaleData(this.locale)

		// Convert `flavour` to an array.
		if (typeof flavour === 'string') {
			flavour = [flavour]
		}

		// "long" flavour is the default one.
		// (it's always present)
		flavour = flavour.concat('long')

		// Find a suitable flavour.
		for (const _ of flavour) {
			if (localeData[_]) {
				return {
					flavour : _,
					localeData : localeData[_]
				}
			}
		}

		// Can't happen - "long" flavour is always present.
		// throw new Error(`None of the flavours - ${flavour.join(', ')} - was found for locale "${this.locale}".`)
	}
}

/**
 * Gets default locale.
 * @return  {string} locale
 */
JavascriptTimeAgo.getDefaultLocale = RelativeTimeFormat.getDefaultLocale

/**
 * Sets default locale.
 * @param  {string} locale
 */
JavascriptTimeAgo.setDefaultLocale = RelativeTimeFormat.setDefaultLocale

/**
 * Adds locale data for a specific locale.
 * @param {Object} localeData
 */
JavascriptTimeAgo.addLocale = function(localeData) {
	addLocaleData(localeData)
	RelativeTimeFormat.addLocale(localeData)
}

/**
 * (legacy alias)
 * Adds locale data for a specific locale.
 * @param {Object} localeData
 * @deprecated
 */
JavascriptTimeAgo.locale = JavascriptTimeAgo.addLocale

// Normalizes `.format()` `time` argument.
function getDateAndTimeBeingFormatted(input)
{
	if (input.constructor === Date || isMockedDate(input))
	{
		return {
			date : input,
			time : input.getTime()
		}
	}

	if (typeof input === 'number')
	{
		return {
			time : input,
			// `date` is not required for formatting
			// relative times unless "twitter" style is used.
			// date : new Date(input)
		}
	}

	// For some weird reason istanbul doesn't see this `throw` covered.
	/* istanbul ignore next */
	throw new Error(`Unsupported relative time formatter input: ${typeof input}, ${input}`)
}

// During testing via some testing libraries `Date`s aren't actually `Date`s.
// https://github.com/catamphetamine/javascript-time-ago/issues/22
function isMockedDate(object) {
	return typeof object === 'object' && typeof object.getTime === 'function'
}

// Get available time interval measurement units.
function getTimeIntervalMeasurementUnits(allowedUnits, localeDataForStyle, _getNowMessage) {
	// Get all time interval measurement units that're available
	// in locale data for a given time labels style.
	let units = Object.keys(localeDataForStyle)

	// `now` unit is handled separately and is shipped in its own `now.json` file.
	// `now.json` isn't present for all locales, so it could be substituted with
	// ".second.current".
	// Add `now` unit if it's available in locale data.
	if (_getNowMessage()) {
		units.push('now')
	}

	// If only a specific set of available time measurement units can be used
	// then only those units are allowed (if they're present in locale data).
	if (allowedUnits) {
		units = allowedUnits.filter(unit => unit === 'now' || units.indexOf(unit) >= 0)
	}

	// `now` unit is handled separately and is shipped in its own `now.json` file.
	// // Stock `Intl.RelativeTimeFormat` locale data doesn't have "now" units.
	// // So either "now" is present in extended locale data
	// // or it's taken from ".second.current".
	// // If "now" unit isn't explicitly allowed, then don't allow it
	// // unless `second` label doesn't provide "current"
	// if ((!allowedUnits || allowedUnits.indexOf('now') >= 0) &&
	// 	units.indexOf('now') < 0) {
	// 	if (localeData.second.current) {
	// 		units.unshift('now')
	// 	}
	// }

	return units
}

function getNowMessage(future, localeDataForStyle, localeDataLong, localeDataNow) {
	const nowLabel = localeDataForStyle.now || (localeDataNow && localeDataNow.now)
	// Specific "now" message form extended locale data (if present).
	if (nowLabel) {
		// Bundle size optimization technique.
		if (typeof nowLabel === 'string') {
			return nowLabel
		}
		// Not handling `value === 0` as `localeData.now.current` here
		// because it wouldn't make sense: "now" is a moment,
		// so one can't possibly differentiate between a
		// "previous" moment, a "current" moment and a "next moment".
		// It can only be differentiated between "past" and "future".
		if (future) {
			return nowLabel.future
		} else {
			return nowLabel.past
		}
	}
	// Use ".second.current" as "now" message.
	// If this function was called then it means that
	// either "now" unit messages are available or
	// ".second.current" message is present.
	return localeDataLong.second.current
}