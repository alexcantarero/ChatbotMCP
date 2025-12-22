import express from 'express';
import { fetchAmadeusAccessToken } from '../app.js';

const router = express.Router();


router.get('/get-flight-offers', async (req, res) => {

    try{

        console.log('Fetching flight offers from ', req.query.originIataCode, ' to ', req.query.destinationIataCode, ' on date ', req.query.departureDate);

        const originIataCode = req.query.originIataCode;
        const destinationIataCode = req.query.destinationIataCode;
        const departureDate = req.query.departureDate;
        const adults = req.query.adults;

        if(!originIataCode || !destinationIataCode || !departureDate || !adults) {
            return res.status(400).json({ error: 'Missing required query parameters' });
        }

        let apiUrl = `https://test.api.amadeus.com/v2/shopping/flight-offers?originLocationCode=${originIataCode}&destinationLocationCode=${destinationIataCode}&departureDate=${departureDate}&adults=${adults}`;

        if(req.query.returnDate){
            apiUrl += `&returnDate=${req.query.returnDate}`;
        }
        if(req.query.maxPrice){
            apiUrl += `&maxPrice=${req.query.maxPrice}`;
        }
        if(req.query.includedAirlines){
            apiUrl += `&includedAirlineCodes=${req.query.includedAirlines}`;
        }
        if(req.query.excludedAirlines){
            apiUrl += `&excludedAirlineCodes=${req.query.excludedAirlines}`;
        }
        if(req.query.travelClass){
            apiUrl += `&travelClass=${req.query.travelClass}`;
        }
        console.log('Constructed API URL:', apiUrl);
        const tokenAmadeus = await fetchAmadeusAccessToken();
        console.log('Fetched Amadeus access token', tokenAmadeus);
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${tokenAmadeus}`
            }
        });
        if(!response.ok) {
            throw new Error ('Error fetching flight offers from Amadeus API');
        }
        console.log('Flight offers response received.');
        const flightOffers = await response.json();
        if(flightOffers.data && Array.isArray(flightOffers.data)) {
            flightOffers.data = flightOffers.data.slice(0, 10); //Escogemos sólo 10 ofertas de vuelos.
        }
        console.log('Fetched flight offers.');
        res.json({ flightOffers: flightOffers } );
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error in /get-flight-offers' });
    }
});

router.get('/get-airport-info', async (req, res) => {

    try{

        const iataCode = req.query.iataCode;
        if(!iataCode) {
            return res.status(400).json({ error: 'Missing iataCode query parameter' });
        }
        const amadeusCode = 'C' + iataCode;
        const apiUrl = `https://test.api.amadeus.com/v1/reference-data/locations/${amadeusCode}`;
        console.log('Fetching airport info for IATA code:', amadeusCode);
        const tokenAmadeus = await fetchAmadeusAccessToken();
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${tokenAmadeus}`
            }
        });

        if(!response.ok) {
            throw new Error ('Error fetching airport info from Amadeus API');
        }

        const airportInfo = await response.json();


        res.json({ airportInfo: airportInfo });
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error in /get-airport-info' });
    }
});

router.get('/search-hotels-near-to-place', async (req, res) => {
    try{

        const latitude = req.query.latitude;
        const longitude = req.query.longitude;

        if(!latitude || !longitude) {
            return res.status(400).json({ error: 'Missing latitude or longitude query parameters' });
        }

        var apiUrl = `https://test.api.amadeus.com/v1/reference-data/locations/hotels/by-geocode?latitude=${latitude}&longitude=${longitude}`;
        
        if(req.query.radiusinKM){
                apiUrl += `&radius=${req.query.radiusinKM}&radiusUnit=KM`;
        }
        const tokenAmadeus = await fetchAmadeusAccessToken(); 
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${tokenAmadeus}`
            }
        });

        if(!response.ok) {
            throw new Error ('Error fetching hotel info from Amadeus API');
        }
        const hotelInfo = await response.json();

        if(hotelInfo.data && Array.isArray(hotelInfo.data)) {
            hotelInfo.data = hotelInfo.data.slice(0, 10); //Escogemos sólo 10 hoteles.
        }
        res.json({ hotelInfo: hotelInfo });
    }
    catch(error){
        res.status(500).json({ error: 'Internal Server Error in /search-hotels-near-to-place' });
    }

});

router.get('/search-activities-near-place', async (req, res) => {

    try{
        console.log('Searching activities near place.');

        const latitude = req.query.latitude;
        const longitude = req.query.longitude;
        if(!latitude || !longitude) {
            return res.status(400).json({ error: 'Missing latitude or longitude query parameters' });
        }

        var apiUrl = `https://test.api.amadeus.com/v1/shopping/activities?latitude=${latitude}&longitude=${longitude}`;
        if(req.query.radius){
            apiUrl += `&radius=${req.query.radius}`;
        }
        const tokenAmadeus = await fetchAmadeusAccessToken();
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${tokenAmadeus}`
            }
        });
        if(!response.ok) {
            throw new Error ('Error fetching activities from Amadeus API');
        }
        const activitiesInfo = await response.json();
        if(activitiesInfo.data && Array.isArray(activitiesInfo.data)) {
            activitiesInfo.data = activitiesInfo.data.slice(0, 10); //Escogemos sólo 10 actividades.
        }
        res.json({ activitiesInfo: activitiesInfo });

    }catch(error){
        res.status(500).json({ error: 'Internal Server Error in /search-activities-near-place' });
    }
});

router.get('/find-latitude-longitude', async (req, res) => {

    try{
        const place = req.query.place;
        console.log('Finding latitude and longitude for place:', place);
        if(!place) {
            return res.status(400).json({ error: 'Missing place query parameter' });
        }
        const query = encodeURIComponent(place);
        const nominatimUrl = process.env.NOMINATIM_URL;
        if(!nominatimUrl){
            return res.status(500).json({ error: 'Nominatim URL not configured' });
        }
        const apiUrl = `${nominatimUrl}/search?q=${query}&format=json&limit=1`;

        const response = await fetch(apiUrl, {
            headers: {
                'User-Agent': `EChartsMCPN8NRemote/1.0 (alex.cantarero@clearpeaks.com)`
            }
        });

        if(!response.ok) {
            throw new Error ('Error fetching location info from Nominatim API');
        }

        const data = await response.json();
        if(data.length === 0) {
            return res.status(404).json({ error: 'Location not found' });
        }

        const latitude = data[0].lat;
        const longitude = data[0].lon;
        res.json({ latitude: latitude, longitude: longitude });
    }
    catch(error){
        res.status(500).json({ error: 'Internal Server Error in /find-latitude-longitude' });
    }

});

export default router;