/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Date Service for Workflow Date Operations
 * 
 * Provides comprehensive date/time operations using date-fns
 * Supports: current date, arithmetic, formatting, parsing, timezone conversion, differences, and extractions
 * 
 * @module DateService
 */

import { 
  addDays, addWeeks, addMonths, addYears, addHours, addMinutes, addSeconds,
  subDays, subWeeks, subMonths, subYears, subHours, subMinutes, subSeconds,
  format, parse, parseISO,
  differenceInDays, differenceInHours, differenceInMinutes, differenceInSeconds,
  differenceInWeeks, differenceInMonths, differenceInYears,
  startOfDay, startOfWeek, startOfMonth, startOfYear,
  endOfDay, endOfWeek, endOfMonth, endOfYear,
  isBefore, isAfter, isSameDay, isWeekend,
  getYear, getMonth, getDate, getDay, getDayOfYear, getWeek,
  getHours, getMinutes, getSeconds,
  isValid
} from 'date-fns';
import { toZonedTime, formatInTimeZone } from 'date-fns-tz';

export interface DateInput {
  operation: string;
  date?: string | Date;
  date2?: string | Date;
  amount?: number;
  unit?: string;
  formatString?: string;
  timezone?: string;
  inputFormat?: string;
}

export interface DateResult {
  success: boolean;
  result?: any;
  error?: string;
}

export class DateService {
  
  /**
   * Parse input to Date object
   */
  private static parseDate(input: string | Date | undefined, inputFormat?: string): Date {
    if (!input) {
      return new Date();
    }
    
    if (input instanceof Date) {
      return input;
    }
    
    // Try parsing with inputFormat if provided
    if (inputFormat) {
      const parsed = parse(input, inputFormat, new Date());
      if (isValid(parsed)) return parsed;
    }
    
    // Try ISO format
    try {
      const parsed = parseISO(input);
      if (isValid(parsed)) return parsed;
    } catch {}
    
    // Try Date constructor
    const date = new Date(input);
    if (isValid(date)) return date;
    
    throw new Error(`Invalid date: ${input}`);
  }

  /**
   * Main execution method for all date operations
   */
  static execute(input: DateInput): DateResult {
    try {
      const { operation } = input;
      
      switch (operation) {
        case 'now':
          return this.getNow(input);
        case 'today':
          return this.getToday(input);
        case 'add':
          return this.addTime(input);
        case 'subtract':
          return this.subtractTime(input);
        case 'format':
          return this.formatDate(input);
        case 'difference':
          return this.calculateDifference(input);
        case 'startOf':
          return this.getStartOf(input);
        case 'endOf':
          return this.getEndOf(input);
        case 'isBefore':
        case 'isAfter':
        case 'isSameDay':
          return this.compareDate(input);
        case 'extract':
          return this.extractComponent(input);
        case 'convertTimezone':
          return this.convertTimezone(input);
        case 'isWeekend':
          return this.checkIsWeekend(input);
        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }
    } catch (err: any) {
      console.error(`[DateService] Operation failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  private static getNow(input: DateInput): DateResult {
    const now = new Date();
    const formatStr = input.formatString || 'yyyy-MM-dd HH:mm:ss';
    const timezone = input.timezone;
    
    if (timezone) {
      return { success: true, result: formatInTimeZone(now, timezone, formatStr) };
    }
    return { success: true, result: format(now, formatStr) };
  }

  private static getToday(input: DateInput): DateResult {
    const today = startOfDay(new Date());
    const formatStr = input.formatString || 'yyyy-MM-dd';
    return { success: true, result: format(today, formatStr) };
  }

  private static addTime(input: DateInput): DateResult {
    const date = this.parseDate(input.date, input.inputFormat);
    const amount = input.amount || 0;
    const unit = input.unit || 'days';
    
    let result: Date;
    switch (unit) {
      case 'seconds': result = addSeconds(date, amount); break;
      case 'minutes': result = addMinutes(date, amount); break;
      case 'hours': result = addHours(date, amount); break;
      case 'days': result = addDays(date, amount); break;
      case 'weeks': result = addWeeks(date, amount); break;
      case 'months': result = addMonths(date, amount); break;
      case 'years': result = addYears(date, amount); break;
      default: throw new Error(`Invalid unit: ${unit}`);
    }
    
    const formatStr = input.formatString || 'yyyy-MM-dd HH:mm:ss';
    return { success: true, result: format(result, formatStr) };
  }

  private static subtractTime(input: DateInput): DateResult {
    const date = this.parseDate(input.date, input.inputFormat);
    const amount = input.amount || 0;
    const unit = input.unit || 'days';
    
    let result: Date;
    switch (unit) {
      case 'seconds': result = subSeconds(date, amount); break;
      case 'minutes': result = subMinutes(date, amount); break;
      case 'hours': result = subHours(date, amount); break;
      case 'days': result = subDays(date, amount); break;
      case 'weeks': result = subWeeks(date, amount); break;
      case 'months': result = subMonths(date, amount); break;
      case 'years': result = subYears(date, amount); break;
      default: throw new Error(`Invalid unit: ${unit}`);
    }
    
    const formatStr = input.formatString || 'yyyy-MM-dd HH:mm:ss';
    return { success: true, result: format(result, formatStr) };
  }

  private static formatDate(input: DateInput): DateResult {
    const date = this.parseDate(input.date, input.inputFormat);
    const formatStr = input.formatString || 'yyyy-MM-dd HH:mm:ss';
    
    if (input.timezone) {
      return { success: true, result: formatInTimeZone(date, input.timezone, formatStr) };
    }
    return { success: true, result: format(date, formatStr) };
  }

  private static calculateDifference(input: DateInput): DateResult {
    const date1 = this.parseDate(input.date, input.inputFormat);
    const date2 = this.parseDate(input.date2);
    const unit = input.unit || 'days';
    
    let result: number;
    switch (unit) {
      case 'seconds': result = differenceInSeconds(date1, date2); break;
      case 'minutes': result = differenceInMinutes(date1, date2); break;
      case 'hours': result = differenceInHours(date1, date2); break;
      case 'days': result = differenceInDays(date1, date2); break;
      case 'weeks': result = differenceInWeeks(date1, date2); break;
      case 'months': result = differenceInMonths(date1, date2); break;
      case 'years': result = differenceInYears(date1, date2); break;
      default: throw new Error(`Invalid unit: ${unit}`);
    }
    
    return { success: true, result };
  }

  private static getStartOf(input: DateInput): DateResult {
    const date = this.parseDate(input.date, input.inputFormat);
    const unit = input.unit || 'day';
    
    let result: Date;
    switch (unit) {
      case 'day': result = startOfDay(date); break;
      case 'week': result = startOfWeek(date); break;
      case 'month': result = startOfMonth(date); break;
      case 'year': result = startOfYear(date); break;
      default: throw new Error(`Invalid unit: ${unit}`);
    }
    
    const formatStr = input.formatString || 'yyyy-MM-dd HH:mm:ss';
    return { success: true, result: format(result, formatStr) };
  }

  private static getEndOf(input: DateInput): DateResult {
    const date = this.parseDate(input.date, input.inputFormat);
    const unit = input.unit || 'day';
    
    let result: Date;
    switch (unit) {
      case 'day': result = endOfDay(date); break;
      case 'week': result = endOfWeek(date); break;
      case 'month': result = endOfMonth(date); break;
      case 'year': result = endOfYear(date); break;
      default: throw new Error(`Invalid unit: ${unit}`);
    }
    
    const formatStr = input.formatString || 'yyyy-MM-dd HH:mm:ss';
    return { success: true, result: format(result, formatStr) };
  }

  private static compareDate(input: DateInput): DateResult {
    const date1 = this.parseDate(input.date, input.inputFormat);
    const date2 = this.parseDate(input.date2);
    
    let result: boolean;
    switch (input.operation) {
      case 'isBefore': result = isBefore(date1, date2); break;
      case 'isAfter': result = isAfter(date1, date2); break;
      case 'isSameDay': result = isSameDay(date1, date2); break;
      default: throw new Error(`Invalid comparison: ${input.operation}`);
    }
    
    return { success: true, result };
  }

  private static extractComponent(input: DateInput): DateResult {
    const date = this.parseDate(input.date, input.inputFormat);
    const component = input.unit || 'year';
    
    let result: number;
    switch (component) {
      case 'year': result = getYear(date); break;
      case 'month': result = getMonth(date) + 1; break; // 1-12
      case 'date': result = getDate(date); break;
      case 'day': result = getDay(date); break; // 0-6 (Sunday-Saturday)
      case 'dayOfYear': result = getDayOfYear(date); break;
      case 'week': result = getWeek(date); break;
      case 'hour': result = getHours(date); break;
      case 'minute': result = getMinutes(date); break;
      case 'second': result = getSeconds(date); break;
      default: throw new Error(`Invalid component: ${component}`);
    }
    
    return { success: true, result };
  }

  private static convertTimezone(input: DateInput): DateResult {
    const date = this.parseDate(input.date, input.inputFormat);
    const timezone = input.timezone || 'UTC';
    const formatStr = input.formatString || 'yyyy-MM-dd HH:mm:ss';
    
    const zonedDate = toZonedTime(date, timezone);
    return { success: true, result: format(zonedDate, formatStr) };
  }

  private static checkIsWeekend(input: DateInput): DateResult {
    const date = this.parseDate(input.date, input.inputFormat);
    return { success: true, result: isWeekend(date) };
  }
}
