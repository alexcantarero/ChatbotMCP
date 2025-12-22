import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';
import * as dotenv from 'dotenv'; 
import { connect } from 'http2';

dotenv.config(); // Cargar variables de entorno desde el archivo .env

// Helper to request an Amadeus access token using client credentials
async function fetchAmadeusAccessToken(): Promise<string> {
    const clientId = process.env.AMADEUS_API_KEY;
    const clientSecret = process.env.AMADEUS_API_SECRET;
    const baseUrl = process.env.AMADEUS_URL || 'https://test.api.amadeus.com/v1';

    // If client credentials are available, request a token each time
    if (clientId && clientSecret) {
        const tokenUrl = `${baseUrl}/security/oauth2/token`;

        const params = new URLSearchParams();
        params.set('grant_type', 'client_credentials');
        params.set('client_id', clientId);
        params.set('client_secret', clientSecret);

        try {
        const res = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Failed to obtain Amadeus token: ${res.status} ${res.statusText} ${text}`);
        }

        const data = await res.json();
        if (!data || !data.access_token) throw new Error('No access_token returned from Amadeus');
        console.log(data.access_token);
        return data.access_token;
        } catch (error) {
            throw new Error(`Error fetching Amadeus access token: ${error}`);
        }
    }

    // Fallback: if an env token is provided, use it (backwards compatibility)
    if (process.env.AMADEUS_BEARER_TOKEN) {
        return process.env.AMADEUS_BEARER_TOKEN;
    }

    throw new Error('Missing Amadeus credentials: set AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET, or AMADEUS_BEARER_TOKEN in env');
}


// Create an MCP server
const server = new McpServer({
    name: 'demo-server',
    version: '1.0.0'
});

// Generación de options de ECharts
server.registerTool(
    'options-echarts-generation',
    {
        title: 'Echarts Options Generation Tool',
        description: `Tool to display the options to create an ECharts chart. 
        CRITICAL: The output MUST be a JavaScript variable assignment in this format (not JSON):
            option = {
                title: {
                text: 'ECharts Getting Started Example'
                },
                tooltip: {},
                legend: {
                data: ['sales']
                },
                xAxis: {
                data: ['Shirts', 'Cardigans', 'Chiffons', 'Pants', 'Heels', 'Socks']
                },
                yAxis: {},
                series: [
                {
                    name: 'sales',
                    type: 'bar',
                    data: [5, 20, 36, 10, 10, 20]
                }
                ]
            }
            This example is to create a bar chart. More types of charts can be created, such as line, pie, etc.
            
            Format rules:
            - Start with "option = {"
            - No comments (//)
            - No semicolon at the end
            - Valid JavaScript that can be executed directly
            - Include a message ALWAYS BEFORE the variable assignment indicating that these are the ECharts options.`
        },
    async({ /* no input parameters */ } ) => {
        const output = {
        };
        return {
            content: [{ type: 'text', text: JSON.stringify(output) }],
        }
    }
);

// Call amadeus flight API to get flight offers between two locations in a given date.
server.registerTool(
    'get-flight-offers',
    {
        title: 'Get Flight Offers Tool',
        description: `Tool to get flight offers between two locations using their IATA codes. 
        
                        CRITICAL OUTPUT LIMIT: You MUST show a MAXIMUM of 10 flight offers to the user, even if the API returns more results. 
                        Select the 10 best or most relevant options. This is mandatory to prevent system saturation.
        
                        The user MUST provide COMPULSORY parameters:
                        - A valid origin city. The LLM should provide the IATA code (originIataCode).
                        - A valid destination city. The LLM should provide the IATA code (destinationIataCode).
                        - The departure date (departureDate). 
                        - The number of adult passengers (adults) to format to retrieve the desired data.
                        IF any of this parameters is MISSING, you MUST inform the user specifically about it, because the search won't work.

                        CRITICAL DATE HANDLING: 
                        - If the user does NOT specify a year, you MUST assume the current year is 2025
                        - The departure date must be from today onwards - warn the user if the provided date is in the past
                        - The LLM should transform every date in 'YYYY-MM-DD' format.

                        Optional parameters:
                        - The return date (returnDate). The LLM should transform it in 'YYYY-MM-DD' format.
                        - The maximum price to pay (maxPrice).
                        - The included airlines separated by comma (includedAirlines). The LLM should provide the IATA codes of the airlines if the user provides the names.
                        - The excluded airlines separated by comma (excludedAirlines). The LLM should provide the IATA codes of the airlines if the user provides the names.
                        - The travel class (travelClass), e.g., ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST
                        
                        Output formatting requirements - Present each flight offer with:
                        ✈️ **Flight [number]**: [Airline name]
                        📍 **Route**: [Origin City] → [Destination City]
                        🕐 **Departure**: [Date and time]
                        🕐 **Arrival**: [Date and time]
                        ⏱️ **Duration**: [Total flight duration]
                        💺 **Class**: [Travel class]
                        💰 **Price**: [Amount in currency]
                        🔄 **Stops**: [Number of stops or "Direct flight"]
                        
                        Use clear sections (there should be clear separation between caracteristics of the same flight and between flight offers), emojis for visual appeal, bold text for labels, and proper spacing between offers.
                        Group information logically and make it scannable at a glance.
                        
                        Additional notes:
                        - It is not necessary for the user to provide the IATA codes or the dates in the specific format
                        - The LLM must transform city names to IATA codes and dates to YYYY-MM-DD format
                        - By default, show the best 5 flight offers
                        - Encourage users to ask for more options if needed (but never exceed 10 total)
                        
                        IMPORTANT: After showing flight offers, suggest to the user if they would like to search for hotels at the destination.
                        If there aren't any flights available, inform the user that no flight offers were found for the provided parameters, by showing ALSO the SPECIFIC date. 

                        CRITICAL ERROR HANDLING: If the search did not provide any results, you MUST inform the user if there is ANY PARAMETER WRONG or that HE/SHE DID NOT PROVIDE. 
                        Wrong parameter example: If the user provided an invalid date (an outdated one), inform him/her specifically about that so they can provide another date.
                        Missing parameter: For example, if the user did not provide the number of adults, inform him/her of the lack of this parameter.

                        `,
        inputSchema: {
            originIataCode: z.string().describe('A valid origin IATA airport code'),
            destinationIataCode: z.string().describe('A valid destination IATA airport code'),
            departureDate: z.string().describe('Departure date in YYYY-MM-DD format'),
            adults: z.number().describe('Number of adult passengers'),
            returnDate: z.string().optional().describe('Return date in YYYY-MM-DD format (optional)'),
            maxPrice: z.string().optional().describe('Maximum price to pay (optional)'),
            includedAirlines: z.string().optional().describe('Included airlines separated by comma (optional)'),
            excludedAirlines: z.string().optional().describe('Excluded airlines separated by comma (optional)'),
            travelClass: z.string().optional().describe('Travel class, e.g., ECONOMY, PREMIUM_ECONOMY, BUSINESS, FIRST (optional)')

        },
        outputSchema: {
            flightOffers: z.string().describe('JSON string containing the flight offers information')
        }
    },
    async({ originIataCode, destinationIataCode, departureDate, adults, returnDate, maxPrice, includedAirlines, excludedAirlines, travelClass }, _extra) => {
        // Calling the amadeus flight API to get flight offers
        try {
            console.log('Fetching flight offers from', originIataCode, 'to', destinationIataCode, 'on', departureDate);    
            var apiUrl = `https://test.api.amadeus.com/v2/shopping/flight-offers?originLocationCode=${originIataCode}&destinationLocationCode=${destinationIataCode}&departureDate=${departureDate}&adults=${adults}`;
            //Optional parameters
            if(returnDate) {
                apiUrl += `&returnDate=${returnDate}`;
            }
            if(maxPrice) {
                apiUrl += `&maxPrice=${maxPrice}`;
            }
            if(includedAirlines) {
                apiUrl += `&includedAirlineCodes=${includedAirlines}`;
            }
            if(excludedAirlines) {
                apiUrl += `&excludedAirlineCodes=${excludedAirlines}`;
            }
            if(travelClass) {
                apiUrl += `&travelClass=${travelClass}`;
            }
            console.log('API URL:', apiUrl);
            const tokenAmadeus = await fetchAmadeusAccessToken();
            console.log('Amadeus token fetched successfully', tokenAmadeus);
            const response = await fetch(apiUrl, {
                headers: {
                    'Authorization': `Bearer ${tokenAmadeus}`
                }
            });
            if (!response.ok) {
                throw new Error('Failed to fetch flight offers');

            }
            const flightOffers = await response.json();
            const flightOffersJson = JSON.stringify(flightOffers);
            console.log('Flight offers fetched successfully');
            return {
                content: [{ type: 'text', text: flightOffersJson }],
                structuredContent: { flightOffers: flightOffersJson }
            };
        } catch (error) {
            const errJson = JSON.stringify({ error: 'Failed to fetch flight offers' });
            return {
                content: [{ type: 'text', text: errJson }],
                structuredContent: { flightOffers: errJson },
                isError: true
            };
        }
    }
);


//Tool to represent flights visually 

server.registerTool(
    'show-flight-trajectory',
    {
        title: 'Show Flight Trajectory Tool',
        description: `Tool that helps to display the trajectory of a flight on a map. The user should indicate which of the flights found with the tool ('get-flight-offers') wants to visualize on a map. Then, the LLM must provide the necessary data to plot the flight trajectory,
                      by also searching the latitude and longitude of the airports.
        
                      The output must contain TWO parts:
                      1. A brief summary of the flight details
                      2. The map options in the exact format required
                        CRITICAL: The output MUST be a JavaScript variable assignment in this EXACT format (not JSON):
                        
                      ❌ WRONG - Do NOT return:
                      \`\`\`javascript
                      results = [...]
                      \`\`\`
                      
                      ✅ CORRECT - Return ONLY this (plain text):
                      results = [
                        { originIATA: 'BCN', latitude: 41.2971, longitude: 2.0785},
                        { layoverIATA: 'LHR', latitude: 51.4700, longitude: -0.4543},
                        { destinationIATA: 'MAD', latitude: 40.4779, longitude: -3.5661}
                      ]
                      
                      Format rules:
                      - Start directly with "results = ["
                      - First one is always originIATA, last one is always destinationIATA, any in between are layoverIATA
                      - Do NEVER include information with a null value. If there are no layovers, only include originIATA and destinationIATA.
                      - NO markdown code fences (\`\`\`javascript or \`\`\`)
                      - NO backticks anywhere
                      - Plain text output only
                      - No comments (//)
                      - No semicolon at the end
                      - Valid JavaScript that can be executed directly in the frontend`,
                                    
    },
        async({ /* no input parameters */ } ) => {
        const output = {
        };
        console.log('Showing map options for flights');
        return {
            content: [{ type: 'text', text: JSON.stringify(output) }],
        }
    }
);

// Call amadeus flight API to get airport information.
server.registerTool(
    'get-airport-info',
    {
        title: 'Get Airport Information Tool',
        description: `Tool to get information about an airport using its IATA code.
                        The user should provide a valid IATA code (iataCode) as input to retrieve the desired data, as well as an amadeus API Bearer token (token). Then it will be sent to 
                        Amadeus Flight API. For example, the IATA code for Madrid airport is 'MAD'.`,
        inputSchema: { 
            iataCode: z.string().describe('A valid IATA airport code')
        },
        outputSchema: {
            airportInfo: z.string().describe('JSON string containing the airport information'),
        }
    },
    async({ iataCode }, _extra) => {
        // Calling the amadeus flight API to get airport information
        try {
            const amadeusCode = 'C' + iataCode;
            console.log('Fetching info for Amadeus code:', amadeusCode);
            const token = await fetchAmadeusAccessToken();
            const apiUrl = `https://test.api.amadeus.com/v1/reference-data/locations/${amadeusCode}`;

            const tokenAmadeus = token;
            const response = await fetch(apiUrl, {
                headers: {
                    'Authorization': `Bearer ${tokenAmadeus}`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch airport information');
            }

            const airportInfo = await response.json();
            const airportInfoJson = JSON.stringify(airportInfo);

            return {
                content: [{ type: 'text', text: airportInfoJson }],
                structuredContent: { airportInfo: airportInfoJson }
            };
        } catch (error) {
            const errJson = JSON.stringify({ error: 'Failed to fetch airport information' });
            return {
                content: [{ type: 'text', text: errJson }],
                structuredContent: { airportInfo: errJson },
                isError: true
            };
        }
    }
);

server.registerTool(
    'search-hotel-near-to-place',
    {
        title: 'Search Hotel Near to Place Tool',
        description: `Tool to search hotels near to a specific place using its name or address.
                        The user should provide:
                        - A valid place name or address (place) as input to retrieve the desired data. The LLM should find the corresponding latitude (lat) and longitude (long)
                        of the place in geometric degrees to perform the search.
                        Also optionally, the user can provide:
                        - The radius in kilometers to search for hotels near to the place (radiusinKM).
                        CRITICAL: After successfully retrieving hotel information, you MUST immediately call the 'show-map-options' tool 
                        to display the hotels' locations that you found on a map. Pass the hotel data (name, latitude, longitude) from this search to that tool.
                        
                        Format rules:
                        - Do not include more than 10 hotels in the output, even if more are found. You might saturate the map otherwise.`,
        inputSchema: {
            latitude: z.string().describe('A valid latitude'),
            longitude: z.string().describe('A valid longitude'),
            radiusinKM: z.number().optional().describe('Radius in kilometers to search for hotels near to the place (optional)')
        }/*,
        outputSchema: {
            hotelInfo: z.string().describe('JSON string containing hotels\' information that are near to the specified place')
        }*/
    },
    async({ latitude, longitude, radiusinKM}, _extra) => {

        try {
        
            var apiUrl = `https://test.api.amadeus.com/v1/reference-data/locations/hotels/by-geocode?latitude=${latitude}&longitude=${longitude}`;
            console.log('API URL:', apiUrl);
            console.log('Latitude:', latitude, 'Longitude:', longitude);
            if (radiusinKM) {
                apiUrl += `&radius=${radiusinKM}&radiusUnit=KM`;
            }
            const tokenAmadeus = await fetchAmadeusAccessToken();
            const response = await fetch(apiUrl, {
                headers: {
                    'Authorization': `Bearer ${tokenAmadeus}`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch hotel information');
            }
            const hotelInfo = await response.json();
            if(hotelInfo.data && Array.isArray(hotelInfo.data)) {
                hotelInfo.data = hotelInfo.data.slice(0, 10);
                console.log('[DEBUG - Line 569] Hotels after limiting:', hotelInfo.data.length);
            }
            //const hotelInfoJson = JSON.stringify(hotelInfo);
            return {
                content: [{ type: 'text', text: hotelInfo }],
                structuredContent: { hotelInfo: hotelInfo }
            };
        } catch (error) {
            const errJson = JSON.stringify({ error: 'Failed to fetch hotels near to place' });
            return {
                content: [{ type: 'text', text: errJson }],
                structuredContent: { hotelInfo: errJson },
                isError: true
            };
        
        }
        
    }
    
);

server.registerTool(
    'show-map-options',
    {
        title: 'Show Map Options Tool',
        description: `Tool to display hotel/activity locations on a map. This tool MUST be called automatically after 'search-hotel-near-to-place'or 'search-activities-near-place' is executed.
                      
                      The output must contain TWO parts:
                      1. A brief summary list of the hotels/activities found
                      2. The map options in the exact format required


                      CRITICAL: The output MUST be a JavaScript variable assignment in this EXACT format (not JSON):
                      If the user is searching for hotels:
                      
                      results = [
                        { name: 'Hotel A', latitude: 40.4168, longitude: -3.7038, address: 'Address A' },
                        { name: 'Hotel B', latitude: 40.4180, longitude: -3.6919, address: 'Address B' },
                        { name: 'Hotel C', latitude: 40.4098, longitude: -3.7076, address: 'Address C' }
                      ]

                      If the user is searching for activities:
                        results = [
                        { name: 'Activity A', latitude: 40.4168, longitude: -3.7038, price: 'Price in €', bookingLink: 'Booking Link A' },
                        { name: 'Activity B', latitude: 40.4180, longitude: -3.6919, price: 'Price in €', bookingLink: 'Booking Link B' },
                        { name: 'Activity C', latitude: 40.4098, longitude: -3.7076, price: 'Price in €', bookingLink: 'Booking Link C' }
                      ]
                      
                      Extract from the search results:
                      - name: The hotel/activity name
                      - latitude: The latitude coordinate (as a number)
                      - longitude: The longitude coordinate (as a number)
                      - address: The hotel address
                      - price: The activity price
                      - bookingLink: The activity booking link

                      Structure the response as:
                      - First: A readable summary like "Found X hotels: Hotel A, Hotel B, Hotel C"
                      - Then: The map options starting with "hotels = ["
                      
                      Format rules:
                      - Always follow the introductory message with the "results = [" variable assignment.
                      - No comments (//)
                      - No quotes inside of quotes('''')
                      - No semicolon at the end
                      - Valid JavaScript that can be executed directly`,
    },
        async({ /* no input parameters */ } ) => {
        const output = {
        };
        console.log('Showing map options for hotels');
        return {
            content: [{ type: 'text', text: JSON.stringify(output) }],
        }
    }
)

//Finds latitude and longitude of a place in particular.
server.registerTool(
    'find-latitude-longitude',
    {
        title: 'Find Latitude and Longitude Tool',
        description: `Tool to find the latitude and longitude of a specific place using its name or address.
                        The user should provide:
                        - A valid place name or address (place) as input to retrieve the desired data.
                        Then, the LLM should find the latitude and longitude of the specified place and return them as output (in geometric degrees):
                        latitude (lat) and longitude (long).`,

        inputSchema: {  place : z.string().describe('A valid place name or address')  },
        /*
        outputSchema: {
            latitude: z.string().describe('The latitude of the specified place'),
            longitude: z.string().describe('The longitude of the specified place')
        }
        */

    },
        async({ place }) => {

            const query = encodeURIComponent(place);
            const nominatimUrl = process.env.NOMINATIM_URL;
            const apiUrl = `${nominatimUrl}/search?q=${query}&format=json&limit=1`;

            const response = await fetch(apiUrl, {
                headers: {
                    'User-Agent': `EChartsMCPN8NRemote/1.0 (alex.cantarero@clearpeaks.com)`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch latitude and longitude information');
            }
            const data = await response.json();
            if (data.length === 0) {
                throw new Error('No results found for the specified place');        
            }

            const latitude = data[0].lat;
            const longitude = data[0].lon;


            const output = { latitude, longitude };
            console.log('Found latitude and longitude for the specified place:', place, latitude, longitude);
            return {
                content: [{ type: 'text', text: JSON.stringify(output) }],
            };
    }
);

server.registerTool(
    'search-activities-near-place',
    {
        title: 'Search Activities Near to Place Tool',
        description: `Tool to search activities near to a specific place using its name or address.
                        The user should provide:
                        - A valid place name or address (place) as input to retrieve the desired data. The LLM should find the corresponding latitude (lat) and longitude (long)
                        of the place in geometric degrees to perform the search.
                        Also optionally, the user can provide:
                        - A radius (radius) in meters to limit the search area.

                        CRITICAL: After successfully retrieving activity information, you MUST immediately call the 'show-map-options' tool 
                        to display the activities' locations that you found on a map. Pass the activity data (name, latitude, longitude, price, bookingLink) from this search to that tool.
                        
                        You should provide for the output this information about each activity found: 
                        - name of the activity
                        - short description (not more than 2 sentences)
                        - address
                        - price amount (if available)
                        - Minium duration (if available)
                        - Booking link (if available)
                        Do not forget to format it properly to be easily readable by the user. If the user does not mention how many activities wants to see, show at maximum 5 activities per message.`,
        
        inputSchema: {
            latitude: z.string().describe('A valid latitude'),
            longitude: z.string().describe('A valid longitude'),
            radius: z.number().optional().describe('Radius in meters to search for activities near to the place (optional)')
        },
        outputSchema: {
            activitiesInfo: z.string().describe('JSON string containing activities\' information that are near to the specified place')
        }
    },
    async({ latitude, longitude, radius }, _extra) => {
        try {
            console.log('[DEBUG - Line 528] Starting search-activities-near-place');
            console.log('[DEBUG - Line 529] Input params:', { latitude, longitude, radius });
            
            var apiUrl = `https://test.api.amadeus.com/v1/shopping/activities?latitude=${latitude}&longitude=${longitude}`;
            if (radius) {
                apiUrl += `&radius=${radius}`;
            }
            console.log('[DEBUG - Line 535] API URL constructed:', apiUrl);
            
            console.log('[DEBUG - Line 537] Fetching Amadeus access token...');
            const tokenAmadeus = await fetchAmadeusAccessToken();
            console.log('[DEBUG - Line 539] Amadeus token fetched successfully');
            
            console.log('[DEBUG - Line 541] Making API request...');
            const response = await fetch(apiUrl, {
                headers: {
                    'Authorization': `Bearer ${tokenAmadeus}`
                }
            });
            console.log('[DEBUG - Line 546] Response received, status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('[ERROR - Line 550] API request failed with status:', response.status);
                console.error('[ERROR - Line 551] Response body:', errorText);
                throw new Error(`Failed to fetch activities information. Status: ${response.status}, Body: ${errorText}`);
            }
            
            console.log('[DEBUG - Line 555] Parsing JSON response...');
            const activitiesInfo = await response.json();
            console.log('[DEBUG - Line 557] JSON parsed successfully');
            console.log('[DEBUG - Line 558] Response structure:', Object.keys(activitiesInfo));
            
            if (activitiesInfo.data) {
                console.log('[DEBUG - Line 561] Total activities found:', activitiesInfo.data.length);
            } else {
                console.log('[WARNING - Line 563] No data property in response');
            }
            
            if(activitiesInfo.data && Array.isArray(activitiesInfo.data)) {
                console.log('[DEBUG - Line 567] Limiting to 10 activities');
                activitiesInfo.data = activitiesInfo.data.slice(0, 10);
                console.log('[DEBUG - Line 569] Activities after limiting:', activitiesInfo.data.length);
            }
            
            console.log('[DEBUG - Line 571] Converting to JSON string...');
            const activitiesInfoJson = JSON.stringify(activitiesInfo);
            console.log('[DEBUG - Line 573] Success! Returning activities data');
            
            return {
                content: [{ type: 'text', text: activitiesInfoJson }],
                structuredContent: { activitiesInfo: activitiesInfoJson }
            };
        } catch (error) {
            console.error('[ERROR - Catch Block] Exception caught in search-activities-near-place');
            console.error('[ERROR] Error type:', error instanceof Error ? error.constructor.name : typeof error);
            console.error('[ERROR] Error message:', error instanceof Error ? error.message : String(error));
            console.error('[ERROR] Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
            
            const errJson = JSON.stringify({ 
                error: 'Failed to fetch activities near to place',
                details: error instanceof Error ? error.message : String(error),
                type: error instanceof Error ? error.constructor.name : typeof error
            });
            return {
                content: [{ type: 'text', text: errJson }],
                structuredContent: { activitiesInfo: errJson },
                isError: true
            };
        }
    }
);

server.registerTool(
    'most-traveled-destinations',
    {
        title: 'Most Traveled Destinations Tool',
        description: `Tool to get the most traveled destinations worldwide. The user must input: 
                        - Name of a city. Then the LLM should provide the IATA code of that city (cityIataCode) to get the most traveled destinations from there.
                        - A month in a specific year (YearMonth). The LLM should transform the month in 'YYYY-MM' format to get the most traveled destinations during that month.
                        For example, if the user provides 'Madrid' as city and 'March 2025' as month, the LLM should transform them to 'MAD' and '2025-03' respectively. Future dates are not allowed.
                        There is only data from January 2011 until March 2018. Future dates are not allowed. If there is no information for the provided month, inform the user about it.
                        As output:
                        -  IATA codes of the destinations, which must be transformed to city names for better readability.
                        -  Score. Pick the flight score one.`,
        inputSchema: {
            cityIataCode: z.string().describe('A valid origin city IATA airport code'),
            yearMonth: z.string().describe('Month and year in YYYY-MM format')
        },
        outputSchema: {
            destinationsInfo: z.string().describe('JSON string containing the most traveled destinations information')
        }
    },
    async({ cityIataCode, yearMonth }, _extra) => {
        // Calling the amadeus flight API to get most traveled destinations
        try {
            console.log('Fetching most traveled destinations from', cityIataCode, 'for', yearMonth);
            var apiUrl = `https://test.api.amadeus.com/v1/travel/analytics/air-traffic/traveled?originCityCode=${cityIataCode}&period=${yearMonth}`;

            console.log('API URL:', apiUrl);
            const tokenAmadeus = await fetchAmadeusAccessToken();
            const response = await fetch(apiUrl, {
                headers: {
                    'Authorization': `Bearer ${tokenAmadeus}`
                }
            });
            if (!response.ok) {
                if(response.status === 400) {
                    throw new Error('Bad Request: Please ensure the date is between January 2011 and March 2018.');
                }
                if(response.status === 404) {
                    throw new Error('Not Found: No data available for the provided parameters.');
                }
                throw new Error('Failed to fetch most traveled destinations');
            }
            const destinationsInfo = await response.json();
            const destinationsInfoJson = JSON.stringify(destinationsInfo);
            console.log('Most traveled destinations fetched successfully');
            return {
                content: [{ type: 'text', text: destinationsInfoJson }],
                structuredContent: { destinationsInfo: destinationsInfoJson }
            };
        }
        catch (error) {
            const errJson = JSON.stringify({ error: 'Failed to fetch most traveled destinations' });
            return {
                content: [{ type: 'text', text: errJson }],
                structuredContent: { destinationsInfo: errJson },
                isError: true
            };
        }
    }

)

// Set up Express and HTTP transport
const app = express();
app.use(express.json());

app.post('/mcp', async (req, res) => {
    // Create a new transport for each request to prevent request ID collisions
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
    });

    res.on('close', () => {
        transport.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
});

const port = parseInt('3000');
app.listen(port, () => {
    console.log(`Demo MCP Server running on http://localhost:${port}/mcp`);
    
    
}).on('error', error => {
    console.error('Server error:', error);
    process.exit(1);
});