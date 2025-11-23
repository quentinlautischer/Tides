import webbrowser
import datetime
from enum import Enum
import csv 


class Station(Enum):
    Vancouver = 7735
    LionsGate = 7720

class TideEntryValue:
    TideHeight: float
    DateTime: str

    

print("Welcome to Tides")

## param: numberOfOccurrences is a int value
## param: maxHeight is a decimal/float value
def FindTide(numberOfOccurences, maxHeight, location=Station.Vancouver, dateString=None):
    if (type(numberOfOccurences) is not int): 
        raise TypeError("Number of Occurrences should be of int type")
    
    if (type(maxHeight) is not float):
        raise TypeError("MaxHeight should be of float type")

    date = datetime.date.today()   
    if dateString is not None:
        date = datetime.date.fromisoformat(dateString)

    print("Scanning data for location " + str(location) + " from date: " +str(date))
    lowestTideStore = {}

    with open("data/07735_data.csv", "r") as tidedatafile:
        reader = csv.reader(tidedatafile)
        haveSteppedThruMetadata = False
        for row in reader:
            entryDateTime = row[0]
            entryDate = entryDateTime.split(" ")[0]
            entryTime = entryDateTime.split(" ")[1]

            # Logic to skip metadata at beginning that does not start with a date
            haveSteppedThruMetadata = row[0][0] == '2'
            if (haveSteppedThruMetadata == False):
                continue
            
            isoformattedDate = entryDate.replace("/","-")
            if datetime.date.fromisoformat(isoformattedDate) < date:
                continue

            entryHeight = float(row[1])

            # filter any row that has a tide too high
            if (entryHeight > maxHeight):
                continue;

            # Otherwise start processing data
            if entryDate not in lowestTideStore or lowestTideStore[entryDate][0] > entryHeight:
                # We've got enough data, time to exit
                if (len(lowestTideStore) == numberOfOccurences and entryDate not in lowestTideStore):
                    break;
                
                lowestTideStore[entryDate] = (entryHeight, entryDateTime)

            # processing done.
    for date,entry in lowestTideStore.items():
            # silly conversaion from 2025/12/04 23:14 to 2025-12-04T23:14:00.000
            dateString = entry[1]
            dateString = dateString.replace("/", "-")
            dateString = dateString.replace(" ", "T")
            dateString += (":00.000")
            dateValue = datetime.datetime.fromisoformat(dateString)
            print(f"{entry[0]} meters on {dateValue.strftime('%A, %B %d, %Y at %H:%M')}")

def SetLocation():
    print("set location")

def OpenMap():
    webbrowser.open("https://tides.gc.ca/en/stations")    


#FindTide(3, 0.5, date="2025-10-01")
FindTide(10, 0.5)

# OpenMap()